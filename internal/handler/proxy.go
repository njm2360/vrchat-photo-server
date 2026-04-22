package handler

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/owner/vps/internal/db"
	"github.com/owner/vps/internal/imgproc"
	"github.com/owner/vps/internal/middleware"
	"github.com/owner/vps/internal/ratelimit"
	"github.com/owner/vps/internal/security"
)

const maxProxyBytes = 50 << 20

type ProxyHandler struct {
	db         *sql.DB
	dataDir    string
	httpClient *http.Client
	limiter    *ratelimit.Limiter
}

func NewProxyHandler(sqlDB *sql.DB, dataDir string, limiter *ratelimit.Limiter) *ProxyHandler {
	dialer := &net.Dialer{}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("invalid address: %w", err)
			}
			// Resolve DNS once, validate each IP, then dial by IP to eliminate TOCTOU.
			ips, err := net.DefaultResolver.LookupHost(ctx, host)
			if err != nil {
				return nil, fmt.Errorf("dns lookup: %w", err)
			}
			for _, a := range ips {
				ip := net.ParseIP(a)
				if ip == nil || security.IsReservedIP(ip) {
					return nil, fmt.Errorf("blocked: private or reserved address")
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0], port))
		},
	}
	return &ProxyHandler{
		db:         sqlDB,
		dataDir:    dataDir,
		httpClient: &http.Client{Transport: transport},
		limiter:    limiter,
	}
}

func (h *ProxyHandler) Proxy(w http.ResponseWriter, r *http.Request) {
	if !h.limiter.Allow(ratelimit.IPKey(r)) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	q := r.URL.Query()
	rawURL := q.Get("url")
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, "url parameter required")
		return
	}

	useCache := true
	if v := q.Get("cache"); v == "false" || v == "0" {
		useCache = false
	}

	maxDim := 2048
	if v := q.Get("max_dim"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			maxDim = clamp(n, 1, 2048)
		}
	}

	// Build target URL, forwarding extra query params.
	targetURL, err := buildTargetURL(rawURL, q)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid url")
		return
	}

	// Serve from cache before checking host restrictions: cached images are safe to serve to anyone.
	if useCache {
		if cached, err := db.GetProxyCache(h.db, rawURL); err == nil && cached != nil {
			path := db.FileStorePath(h.dataDir, cached.FileID, "png")
			if _, err := os.Stat(path); err == nil {
				w.Header().Set("Content-Type", "image/png")
				http.ServeFile(w, r, path)
				return
			}
		}
	}

	// Fetching from upstream requires auth for hosts not in the DB allowlist.
	authenticated := middleware.UserID(r.Context()) != ""
	if !authenticated && !h.isHostAllowed(targetURL) {
		writeError(w, http.StatusForbidden, "host not allowed")
		return
	}

	// Fetch from upstream.
	resp, err := h.httpClient.Get(targetURL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to fetch image")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("upstream returned %d", resp.StatusCode))
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProxyBytes+1))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to read response")
		return
	}
	if int64(len(body)) > maxProxyBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "image exceeds 50MB limit")
		return
	}

	img, _, err := imgproc.Decode(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "response is not a valid image")
		return
	}

	img = imgproc.FitWithin(img, maxDim, maxDim)

	var buf bytes.Buffer
	if err := imgproc.EncodePNG(&buf, img); err != nil {
		writeError(w, http.StatusInternalServerError, "image encoding failed")
		return
	}
	pngData := buf.Bytes()

	// Store in cache.
	if useCache {
		if entry, oldFileID, err := db.UpsertProxyCache(h.db, rawURL); err == nil {
			os.WriteFile(db.FileStorePath(h.dataDir, entry.FileID, "png"), pngData, 0o644) //nolint:errcheck
			if oldFileID != "" && oldFileID != entry.FileID {
				os.Remove(db.FileStorePath(h.dataDir, oldFileID, "png")) //nolint:errcheck
			}
		}
	}

	w.Header().Set("Content-Type", "image/png")
	w.WriteHeader(http.StatusOK)
	w.Write(pngData) //nolint:errcheck
}

// isHostAllowed checks the DB allowlist. Fails closed on DB error.
func (h *ProxyHandler) isHostAllowed(targetURL string) bool {
	patterns, err := db.GetEnabledProxyHostPatterns(h.db)
	if err != nil {
		return false
	}
	u, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	return matchHostPattern(patterns, strings.ToLower(u.Hostname())) != ""
}

// matchHostPattern returns the first pattern that matches host, or "" if none match.
func matchHostPattern(patterns []string, host string) string {
	host = strings.ToLower(host)
	for _, p := range patterns {
		if strings.EqualFold(p, host) {
			return p
		}
		// Wildcard subdomain: *.example.com matches foo.example.com but not example.com itself.
		if strings.HasPrefix(p, "*.") {
			suffix := strings.ToLower(p[2:])
			if _, after, ok := strings.Cut(host, "."); ok && after == suffix {
				return p
			}
		}
	}
	return ""
}

func buildTargetURL(rawURL string, q url.Values) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("only http/https supported")
	}
	// Merge extra params (skip our own reserved params).
	reserved := map[string]bool{"url": true, "cache": true, "max_dim": true}
	extra := u.Query()
	for k, vs := range q {
		if reserved[strings.ToLower(k)] {
			continue
		}
		for _, v := range vs {
			extra.Add(k, v)
		}
	}
	u.RawQuery = extra.Encode()
	return u.String(), nil
}
