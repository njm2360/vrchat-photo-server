package middleware

import (
	"net"
	"net/http"
	"strings"
)

// NewRealIP returns a middleware that rewrites r.RemoteAddr from proxy headers,
// but only when the TCP connection originates from a trusted proxy CIDR.
// If trustedCIDRs is empty, headers are never trusted and RemoteAddr is used as-is.
func NewRealIP(trustedCIDRs []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(trustedCIDRs) > 0 && isTrustedProxy(r.RemoteAddr, trustedCIDRs) {
				if ip := realIPFromHeaders(r); ip != "" {
					r.RemoteAddr = ip + ":0"
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ParseTrustedProxies parses a comma-separated list of IPs and CIDRs.
func ParseTrustedProxies(s string) ([]*net.IPNet, error) {
	if s == "" {
		return nil, nil
	}
	var nets []*net.IPNet
	for _, raw := range strings.Split(s, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if !strings.Contains(raw, "/") {
			raw += "/32"
		}
		_, cidr, err := net.ParseCIDR(raw)
		if err != nil {
			return nil, err
		}
		nets = append(nets, cidr)
	}
	return nets, nil
}

func isTrustedProxy(remoteAddr string, trusted []*net.IPNet) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, cidr := range trusted {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

func realIPFromHeaders(r *http.Request) string {
	// CF-Connecting-IP is always overwritten by Cloudflare and cannot be
	// spoofed by the client, so prefer it over X-Forwarded-For.
	if cf := r.Header.Get("CF-Connecting-IP"); cf != "" {
		return strings.TrimSpace(cf)
	}
	// X-Real-IP is set by Nginx (single value, no append chain).
	if xrip := r.Header.Get("X-Real-IP"); xrip != "" {
		return strings.TrimSpace(xrip)
	}
	// X-Forwarded-For: use the last entry (set by the trusted proxy itself),
	// not the first (which may be client-supplied and spoofed).
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.Split(fwd, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	return ""
}
