package handler

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/njm2360/vrchat-photo-server/internal/db"
)

type FilesHandler struct {
	db      *sql.DB
	dataDir string
}

func NewFilesHandler(sqlDB *sql.DB, dataDir string) *FilesHandler {
	return &FilesHandler{db: sqlDB, dataDir: dataDir}
}

func (h *FilesHandler) ServeFile(w http.ResponseWriter, r *http.Request) {
	fileID := chi.URLParam(r, "fileID")

	variant, img, err := db.GetVariantByFileID(h.db, fileID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if variant == nil {
		// Not in image_variants; check proxy_cache.
		h.serveProxyFile(w, r, fileID)
		return
	}

	if time.Now().After(img.ExpiresAt) {
		http.Error(w, "Gone", http.StatusGone)
		return
	}

	w.Header().Set("Content-Type", variant.MIMEType)
	http.ServeFile(w, r, db.FileStorePath(h.dataDir, fileID, variant.MIMEType))
}

func (h *FilesHandler) serveProxyFile(w http.ResponseWriter, r *http.Request, fileID string) {
	cache, err := db.GetProxyCacheByFileID(h.db, fileID)
	if err != nil || cache == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	http.ServeFile(w, r, db.FileStorePath(h.dataDir, fileID, "png"))
}
