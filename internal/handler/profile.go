package handler

import (
	"database/sql"
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"github.com/njm2360/vrchat-photo-server/internal/db"
	"github.com/njm2360/vrchat-photo-server/internal/middleware"
)

type ProfileHandler struct {
	db *sql.DB
}

func NewProfileHandler(sqlDB *sql.DB) *ProfileHandler {
	return &ProfileHandler{db: sqlDB}
}

func (h *ProfileHandler) RenameUsername(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "username required")
		return
	}

	userID := middleware.UserID(r.Context())
	if err := db.RenameUser(h.db, userID, req.Username); err != nil {
		writeError(w, http.StatusConflict, "username already exists")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": req.Username})
}

func (h *ProfileHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CurrentPassword == "" || req.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "current_password and new_password required")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	userID := middleware.UserID(r.Context())
	user, err := db.GetUserByID(h.db, userID)
	if err != nil || user == nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(user.PassHash), []byte(req.CurrentPassword)) != nil {
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := db.UpdatePassword(h.db, userID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	db.DeleteRefreshTokensByUserID(h.db, userID) //nolint:errcheck
	w.WriteHeader(http.StatusNoContent)
}
