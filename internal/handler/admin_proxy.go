package handler

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/njm2360/vrchat-photo-server/internal/db"
	"github.com/njm2360/vrchat-photo-server/internal/middleware"
)

func (h *AdminHandler) ListProxyHosts(w http.ResponseWriter, r *http.Request) {
	limit := clamp(queryInt(r, "limit", 20), 1, 100)
	offset := max(queryInt(r, "offset", 0), 0)

	rows, total, err := db.ListProxyAllowedHosts(h.db, db.ListProxyAllowedHostsParams{
		Pattern: r.URL.Query().Get("pattern"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	type hostJSON struct {
		ID                string `json:"id"`
		Pattern           string `json:"pattern"`
		Note              string `json:"note"`
		CreatedAt         string `json:"created_at"`
		CreatedByUsername string `json:"created_by_username"`
		UpdatedAt         string `json:"updated_at"`
		UpdatedByUsername string `json:"updated_by_username"`
		Enabled           bool   `json:"enabled"`
	}
	items := make([]hostJSON, len(rows))
	for i, row := range rows {
		items[i] = hostJSON{
			ID:                row.ID,
			Pattern:           row.Pattern,
			Note:              row.Note,
			CreatedAt:         row.CreatedAt.Format(time.RFC3339),
			CreatedByUsername: row.CreatedByUsername,
			UpdatedAt:         row.UpdatedAt.Format(time.RFC3339),
			UpdatedByUsername: row.UpdatedByUsername,
			Enabled:           row.Enabled,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func isValidProxyHostPattern(pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || pattern == "*" {
		return false
	}
	host := pattern
	if strings.HasPrefix(pattern, "*.") {
		host = pattern[2:]
	}
	// Must not contain scheme, path, or port; must look like a hostname.
	if strings.ContainsAny(host, "/:@?# ") {
		return false
	}
	return host != ""
}

func (h *AdminHandler) CreateProxyHost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pattern string `json:"pattern"`
		Note    string `json:"note"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Pattern = strings.TrimSpace(strings.ToLower(req.Pattern))
	if !isValidProxyHostPattern(req.Pattern) {
		writeError(w, http.StatusBadRequest, "invalid pattern (use *, *.example.com, or example.com)")
		return
	}

	userID := middleware.UserID(r.Context())
	host, err := db.AddProxyAllowedHost(h.db, req.Pattern, req.Note, userID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusConflict, "pattern already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         host.ID,
		"pattern":    host.Pattern,
		"note":       host.Note,
		"created_at": host.CreatedAt.Format(time.RFC3339),
		"updated_at": host.UpdatedAt.Format(time.RFC3339),
		"enabled":    host.Enabled,
	})
}

func (h *AdminHandler) DeleteProxyHost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	found, err := db.DeleteProxyAllowedHost(h.db, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) UpdateProxyHostNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Note string `json:"note"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	userID := middleware.UserID(r.Context())
	found, err := db.UpdateProxyAllowedHostNote(h.db, id, req.Note, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) SetProxyHostEnabled(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	userID := middleware.UserID(r.Context())
	found, err := db.SetProxyAllowedHostEnabled(h.db, id, req.Enabled, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) CheckProxyHost(w http.ResponseWriter, r *http.Request) {
	input := strings.TrimSpace(r.URL.Query().Get("url"))
	if input == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}

	var host string
	if strings.Contains(input, "://") {
		u, err := url.Parse(input)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			writeError(w, http.StatusBadRequest, "invalid url")
			return
		}
		host = strings.ToLower(u.Hostname())
	} else {
		// Bare hostname input (e.g. "example.com")
		host = strings.ToLower(input)
	}
	if host == "" {
		writeError(w, http.StatusBadRequest, "invalid url")
		return
	}

	patterns, err := db.GetEnabledProxyHostPatterns(h.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	matched := matchHostPattern(patterns, host)
	resp := map[string]any{"allowed": matched != "", "matched_pattern": nil}
	if matched != "" {
		resp["matched_pattern"] = matched
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *AdminHandler) ListProxyCache(w http.ResponseWriter, r *http.Request) {
	limit := clamp(queryInt(r, "limit", 20), 1, 100)
	offset := max(queryInt(r, "offset", 0), 0)

	entries, total, err := db.ListProxyCache(h.db, db.ListProxyCacheParams{
		URL:    r.URL.Query().Get("url"),
		Limit:  limit,
		Offset: offset,
		Sort:   r.URL.Query().Get("sort"),
		Order:  r.URL.Query().Get("order"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	type proxyCacheItem struct {
		URL       string `json:"url"`
		FileID    string `json:"file_id"`
		CachedAt  string `json:"cached_at"`
		ExpiresAt string `json:"expires_at"`
	}
	items := make([]proxyCacheItem, len(entries))
	for i, e := range entries {
		items[i] = proxyCacheItem{
			URL:       e.URL,
			FileID:    e.FileID,
			CachedAt:  e.CachedAt.Format(time.RFC3339),
			ExpiresAt: e.ExpiresAt.Format(time.RFC3339),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *AdminHandler) DeleteProxyCache(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}
	found, err := db.DeleteProxyCacheEntry(h.db, h.dataDir, url)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
