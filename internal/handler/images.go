package handler

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/owner/vps/internal/db"
	"github.com/owner/vps/internal/imgproc"
	"github.com/owner/vps/internal/middleware"
)

const maxUploadBytes = 50 << 20 // 50 MB

type ImagesHandler struct {
	db      *sql.DB
	dataDir string
	baseURL string
}

func NewImagesHandler(sqlDB *sql.DB, dataDir, baseURL string) *ImagesHandler {
	return &ImagesHandler{db: sqlDB, dataDir: dataDir, baseURL: baseURL}
}

type imageResponse struct {
	ID         string `json:"id"`
	URL        string `json:"url"`
	ThumbURL   string `json:"thumb_url"`
	Filename   string `json:"filename"`
	MIMEType   string `json:"mime_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	SizeBytes  int64  `json:"size_bytes"`
	UploadedAt string `json:"uploaded_at"`
	ExpiresAt  string `json:"expires_at"`
	Expired    bool   `json:"expired"`
}

func (h *ImagesHandler) Upload(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())

	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large or invalid form")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read error")
		return
	}
	if int64(len(data)) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "file exceeds 50MB limit")
		return
	}

	img, format, err := imgproc.Decode(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid or unsupported image")
		return
	}
	mimeType, _ := imgproc.FormatToMIME(format)

	// Apply rotation.
	rotate := formInt(r, "rotate", 0)
	if rotate != 0 {
		img = imgproc.Rotate(img, rotate)
	}

	// Apply resize.
	maxW := formInt(r, "max_width", 0)
	maxH := formInt(r, "max_height", 0)
	if maxW > 0 || maxH > 0 {
		if maxW <= 0 {
			maxW = 2048
		}
		if maxH <= 0 {
			maxH = 2048
		}
		img = imgproc.FitWithin(img, clamp(maxW, 1, 2048), clamp(maxH, 1, 2048))
	}

	// Re-encode.
	encoded, err := imgproc.Encode(img, mimeType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "image encoding failed")
		return
	}

	// Generate thumbnail.
	thumbData, err := imgproc.MakeThumb(img)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "thumbnail generation failed")
		return
	}

	expireDays := clamp(formInt(r, "expire_days", 30), 1, 365)
	expiresAt := time.Now().UTC().Add(time.Duration(expireDays) * 24 * time.Hour)

	// Insert image record.
	imgRec, err := db.InsertImage(h.db, userID, header.Filename, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	// Save original file.
	origVariant := &db.Variant{
		ImageID:   imgRec.ID,
		Role:      db.RoleOriginal,
		MIMEType:  mimeType,
		Width:     img.Bounds().Dx(),
		Height:    img.Bounds().Dy(),
		SizeBytes: int64(len(encoded)),
	}
	if err := db.InsertVariant(h.db, origVariant); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if err := writeFile(h.dataDir, origVariant.FileID, origVariant.MIMEType, encoded); err != nil {
		writeError(w, http.StatusInternalServerError, "storage error")
		return
	}

	// Save thumbnail.
	thumbVariant := &db.Variant{
		ImageID:   imgRec.ID,
		Role:      db.RoleThumb96,
		MIMEType:  "image/webp",
		Width:     min(img.Bounds().Dx(), 96),
		Height:    min(img.Bounds().Dy(), 96),
		SizeBytes: int64(len(thumbData)),
	}
	if err := db.InsertVariant(h.db, thumbVariant); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if err := writeFile(h.dataDir, thumbVariant.FileID, thumbVariant.MIMEType, thumbData); err != nil {
		writeError(w, http.StatusInternalServerError, "storage error")
		return
	}

	writeJSON(w, http.StatusCreated, h.toResponse(imgRec, origVariant, thumbVariant))
}

func (h *ImagesHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())

	limit := clamp(queryInt(r, "limit", 20), 1, 100)
	offset := max(queryInt(r, "offset", 0), 0)

	var expired *bool
	if v := r.URL.Query().Get("expired"); v != "" {
		b := v == "true" || v == "1"
		expired = &b
	}

	imgs, total, err := db.ListImages(h.db, db.ListImagesParams{
		UploaderID: userID,
		Limit:      limit,
		Offset:     offset,
		Sort:       r.URL.Query().Get("sort"),
		Order:      r.URL.Query().Get("order"),
		Expired:    expired,
		Filename:   r.URL.Query().Get("filename"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	// Batch-load variants.
	ids := make([]string, len(imgs))
	for i, img := range imgs {
		ids[i] = img.ID
	}
	variantMap, err := db.GetVariantsByImageIDs(h.db, ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	items := make([]imageResponse, 0, len(imgs))
	for i := range imgs {
		v := variantMap[imgs[i].ID]
		items = append(items, h.toResponse(&imgs[i], v[db.RoleOriginal], v[db.RoleThumb96]))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *ImagesHandler) ListForAdmin(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	limit := clamp(queryInt(r, "limit", 20), 1, 100)
	offset := max(queryInt(r, "offset", 0), 0)

	var expired *bool
	if v := r.URL.Query().Get("expired"); v != "" {
		b := v == "true" || v == "1"
		expired = &b
	}

	imgs, total, err := db.ListImages(h.db, db.ListImagesParams{
		UploaderID: targetID,
		Limit:      limit,
		Offset:     offset,
		Sort:       r.URL.Query().Get("sort"),
		Order:      r.URL.Query().Get("order"),
		Expired:    expired,
		Filename:   r.URL.Query().Get("filename"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	ids := make([]string, len(imgs))
	for i, img := range imgs {
		ids[i] = img.ID
	}
	variantMap, err := db.GetVariantsByImageIDs(h.db, ids)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	items := make([]imageResponse, 0, len(imgs))
	for i := range imgs {
		v := variantMap[imgs[i].ID]
		items = append(items, h.toResponse(&imgs[i], v[db.RoleOriginal], v[db.RoleThumb96]))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *ImagesHandler) DeleteForAdmin(w http.ResponseWriter, r *http.Request) {
	imageID := chi.URLParam(r, "id")

	img, err := db.GetImage(h.db, imageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if img == nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	variants, err := db.GetVariantsByImageID(h.db, imageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	ok, err := db.DeleteImage(h.db, imageID, img.UploaderID)
	if err != nil || !ok {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}

	for _, v := range variants {
		os.Remove(db.FileStorePath(h.dataDir, v.FileID, v.MIMEType)) //nolint:errcheck
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ImagesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	imageID := chi.URLParam(r, "id")

	img, err := db.GetImage(h.db, imageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if img == nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if img.UploaderID != userID {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	// Collect file IDs before deleting DB rows.
	variants, err := db.GetVariantsByImageID(h.db, imageID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	ok, err := db.DeleteImage(h.db, imageID, userID)
	if err != nil || !ok {
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}

	// Delete files after DB rows are gone.
	for _, v := range variants {
		os.Remove(db.FileStorePath(h.dataDir, v.FileID, v.MIMEType)) //nolint:errcheck
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ImagesHandler) toResponse(img *db.Image, orig, thumb *db.Variant) imageResponse {
	resp := imageResponse{
		ID:         img.ID,
		Filename:   img.OrigName,
		UploadedAt: img.UploadedAt.Format(time.RFC3339),
		ExpiresAt:  img.ExpiresAt.Format(time.RFC3339),
		Expired:    time.Now().After(img.ExpiresAt),
	}
	if orig != nil {
		resp.URL = fmt.Sprintf("%s/files/%s", h.baseURL, orig.FileID)
		resp.MIMEType = orig.MIMEType
		resp.Width = orig.Width
		resp.Height = orig.Height
		resp.SizeBytes = orig.SizeBytes
	}
	if thumb != nil {
		resp.ThumbURL = fmt.Sprintf("%s/files/%s", h.baseURL, thumb.FileID)
	}
	return resp
}

func writeFile(dataDir, fileID, ext string, data []byte) error {
	return os.WriteFile(db.FileStorePath(dataDir, fileID, ext), data, 0o644)
}

func formInt(r *http.Request, key string, def int) int {
	v := r.FormValue(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func queryInt(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
