package handler

import (
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/go-chi/chi/v5"
	"github.com/owner/vps/internal/db"
	appjwt "github.com/owner/vps/internal/jwt"
	"github.com/owner/vps/internal/middleware"
)

func (h *AdminHandler) CheckUsername(w http.ResponseWriter, r *http.Request) {
	username := r.URL.Query().Get("username")
	if username == "" {
		writeError(w, http.StatusBadRequest, "username required")
		return
	}
	user, err := db.GetUser(h.db, username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": user == nil})
}

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit := clamp(queryInt(r, "limit", 20), 1, 100)
	offset := max(queryInt(r, "offset", 0), 0)

	users, total, err := db.ListUsers(h.db, db.ListUsersParams{
		Limit:  limit,
		Offset: offset,
		Search: r.URL.Query().Get("search"),
		Role:   r.URL.Query().Get("role"),
		Status: r.URL.Query().Get("status"),
		Sort:   r.URL.Query().Get("sort"),
		Order:  r.URL.Query().Get("order"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users":  toUserSummaryJSON(users),
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *AdminHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := db.CreateUser(h.db, req.Username, string(hash), req.IsAdmin); err != nil {
		writeError(w, http.StatusConflict, "username already exists")
		return
	}

	user, err := db.GetUser(h.db, req.Username)
	if err != nil || user == nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, userSummaryJSON(db.UserSummary{
		ID:        user.ID,
		Username:  user.Username,
		IsAdmin:   user.IsAdmin,
		CreatedAt: user.CreatedAt,
	}))
}

func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	callerID := middleware.UserID(r.Context())

	if targetID == callerID {
		writeError(w, http.StatusBadRequest, "自分自身は削除できません")
		return
	}

	target, err := db.GetUserByID(h.db, targetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if target.IsAdmin {
		count, err := db.AdminCount(h.db)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if count <= 1 {
			writeError(w, http.StatusBadRequest, "最後の管理者は削除できません")
			return
		}
	}

	if err := db.DeleteUser(h.db, h.dataDir, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")

	var req struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := db.UpdatePassword(h.db, targetID, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	db.DeleteRefreshTokensByUserID(h.db, targetID) //nolint:errcheck
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) RenameUser(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")

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

	if err := db.RenameUser(h.db, targetID, req.Username); err != nil {
		writeError(w, http.StatusConflict, "username already exists")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": targetID, "username": req.Username})
}

func (h *AdminHandler) SetDisabled(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	callerID := middleware.UserID(r.Context())

	if targetID == callerID {
		writeError(w, http.StatusBadRequest, "自分自身は無効化できません")
		return
	}

	var req struct {
		Disabled bool `json:"disabled"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := db.SetDisabled(h.db, targetID, req.Disabled); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if req.Disabled {
		db.DeleteRefreshTokensByUserID(h.db, targetID) //nolint:errcheck
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": targetID, "disabled": req.Disabled})
}

func (h *AdminHandler) Impersonate(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")

	user, err := db.GetUserByID(h.db, targetID)
	if err != nil || user == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if user.IsDisabled {
		writeError(w, http.StatusForbidden, "このアカウントは無効化されています")
		return
	}

	// Save admin's current refresh token as original
	origRTID := middleware.RefreshTokenIDFromRequest(r)
	origRT, err := db.GetRefreshToken(h.db, origRTID)
	if err != nil || origRT == nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Create new refresh token for target user
	newRT, err := db.CreateRefreshToken(h.db, targetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	accessToken, err := appjwt.Sign(user.ID, user.Username, user.IsAdmin, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	middleware.SetOriginalRefreshTokenCookie(w, origRT.ID, origRT.ExpiresAt, h.secureCookie)
	middleware.SetRefreshTokenCookie(w, newRT.ID, newRT.ExpiresAt, h.secureCookie)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": accessToken,
		"username":     user.Username,
		"is_admin":     user.IsAdmin,
	})
}

func (h *AdminHandler) RevokeUserSessions(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	if err := db.DeleteRefreshTokensByUserID(h.db, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) DeleteUserImages(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	if err := db.DeleteUserImages(h.db, h.dataDir, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) SetAdmin(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	callerID := middleware.UserID(r.Context())

	var req struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !req.IsAdmin && targetID == callerID {
		writeError(w, http.StatusBadRequest, "自分自身の管理者権限は剥奪できません")
		return
	}

	if !req.IsAdmin {
		count, err := db.AdminCount(h.db)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if count <= 1 {
			writeError(w, http.StatusBadRequest, "最後の管理者の権限は剥奪できません")
			return
		}
	}

	if err := db.SetAdmin(h.db, targetID, req.IsAdmin); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": targetID, "is_admin": req.IsAdmin})
}

type userSummaryResponse struct {
	ID           string  `json:"id"`
	Username     string  `json:"username"`
	IsAdmin      bool    `json:"is_admin"`
	IsDisabled   bool    `json:"is_disabled"`
	CreatedAt    string  `json:"created_at"`
	LastLoginAt  *string `json:"last_login_at"`
	ImageCount   int     `json:"image_count"`
	StorageBytes int64   `json:"storage_bytes"`
}

func userSummaryJSON(s db.UserSummary) userSummaryResponse {
	r := userSummaryResponse{
		ID:           s.ID,
		Username:     s.Username,
		IsAdmin:      s.IsAdmin,
		IsDisabled:   s.IsDisabled,
		CreatedAt:    s.CreatedAt.Format(time.RFC3339),
		ImageCount:   s.ImageCount,
		StorageBytes: s.StorageBytes,
	}
	if s.LastLoginAt != nil {
		t := s.LastLoginAt.Format(time.RFC3339)
		r.LastLoginAt = &t
	}
	return r
}

func toUserSummaryJSON(users []db.UserSummary) []userSummaryResponse {
	out := make([]userSummaryResponse, len(users))
	for i, u := range users {
		out[i] = userSummaryJSON(u)
	}
	return out
}
