package handler

import (
	"database/sql"
	"log"
	"net/http"

	"golang.org/x/crypto/bcrypt"

	"github.com/njm2360/vrchat-photo-server/internal/db"
	appjwt "github.com/njm2360/vrchat-photo-server/internal/jwt"
	"github.com/njm2360/vrchat-photo-server/internal/middleware"
	"github.com/njm2360/vrchat-photo-server/internal/ratelimit"
)

type AuthHandler struct {
	db           *sql.DB
	jwtSecret    []byte
	limiter      *ratelimit.Limiter
	ipLimiter    *ratelimit.Limiter
	secureCookie bool
}

func NewAuthHandler(sqlDB *sql.DB, jwtSecret []byte, limiter, ipLimiter *ratelimit.Limiter, secureCookie bool) *AuthHandler {
	return &AuthHandler{db: sqlDB, jwtSecret: jwtSecret, limiter: limiter, ipLimiter: ipLimiter, secureCookie: secureCookie}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password required")
		return
	}

	userKey := ratelimit.Key(r, req.Username)
	ipKey := ratelimit.IPKey(r)
	if h.limiter.IsLimited(userKey) || h.ipLimiter.IsLimited(ipKey) {
		writeError(w, http.StatusTooManyRequests, "too many failed attempts, try again later")
		return
	}

	user, err := db.GetUser(h.db, req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	// Always run bcrypt to prevent timing-based username enumeration.
	// Use a dummy hash when the user doesn't exist so the cost is identical.
	hashToCompare := "$2a$10$JwGHY.7szWFwN6r6L4vSMe28fSS59Q/VEADqAwpzDeZ41vlrqP1i2"
	if user != nil {
		hashToCompare = user.PassHash
	}
	if bcrypt.CompareHashAndPassword([]byte(hashToCompare), []byte(req.Password)) != nil || user == nil {
		h.limiter.RecordFailure(userKey)
		h.ipLimiter.RecordFailure(ipKey)
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if user.IsDisabled {
		writeError(w, http.StatusForbidden, "このアカウントは無効化されています")
		return
	}
	h.limiter.Reset(userKey)

	rt, err := db.CreateRefreshToken(h.db, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create session")
		return
	}

	accessToken, err := appjwt.Sign(user.ID, user.Username, user.IsAdmin, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := db.UpdateLastLogin(h.db, user.ID); err != nil {
		log.Printf("update last login: %v", err)
	}

	middleware.SetRefreshTokenCookie(w, rt.ID, rt.ExpiresAt, h.secureCookie)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": accessToken,
		"username":     user.Username,
		"is_admin":     user.IsAdmin,
	})
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	rtID := middleware.RefreshTokenIDFromRequest(r)
	if rtID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	rt, err := db.GetRefreshToken(h.db, rtID)
	if err != nil || rt == nil {
		middleware.ClearRefreshTokenCookie(w)
		writeError(w, http.StatusUnauthorized, "session expired")
		return
	}

	user, err := db.GetUserByID(h.db, rt.UserID)
	if err != nil || user == nil || user.IsDisabled {
		middleware.ClearRefreshTokenCookie(w)
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Rotate: delete old, create new
	db.DeleteRefreshToken(h.db, rt.ID) //nolint:errcheck
	newRT, err := db.CreateRefreshToken(h.db, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	accessToken, err := appjwt.Sign(user.ID, user.Username, user.IsAdmin, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	middleware.SetRefreshTokenCookie(w, newRT.ID, newRT.ExpiresAt, h.secureCookie)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":     accessToken,
		"username":         user.Username,
		"is_admin":         user.IsAdmin,
		"is_impersonating": middleware.OriginalRefreshTokenIDFromRequest(r) != "",
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	rtID := middleware.RefreshTokenIDFromRequest(r)
	if rtID != "" {
		db.DeleteRefreshToken(h.db, rtID) //nolint:errcheck
	}
	middleware.ClearRefreshTokenCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"msg": "ok"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"username":         middleware.Username(r.Context()),
		"is_admin":         middleware.IsAdmin(r.Context()),
		"is_impersonating": middleware.OriginalRefreshTokenIDFromRequest(r) != "",
	})
}

func (h *AuthHandler) ExitImpersonation(w http.ResponseWriter, r *http.Request) {
	origRTID := middleware.OriginalRefreshTokenIDFromRequest(r)
	if origRTID == "" {
		writeError(w, http.StatusBadRequest, "not impersonating")
		return
	}

	origRT, err := db.GetRefreshToken(h.db, origRTID)
	if err != nil || origRT == nil {
		middleware.ClearOriginalRefreshTokenCookie(w)
		writeError(w, http.StatusUnauthorized, "original session expired")
		return
	}

	adminUser, err := db.GetUserByID(h.db, origRT.UserID)
	if err != nil || adminUser == nil {
		middleware.ClearOriginalRefreshTokenCookie(w)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Delete the impersonated user's current refresh token
	currentRTID := middleware.RefreshTokenIDFromRequest(r)
	db.DeleteRefreshToken(h.db, currentRTID) //nolint:errcheck

	accessToken, err := appjwt.Sign(adminUser.ID, adminUser.Username, adminUser.IsAdmin, h.jwtSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	middleware.SetRefreshTokenCookie(w, origRT.ID, origRT.ExpiresAt, h.secureCookie)
	middleware.ClearOriginalRefreshTokenCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": accessToken,
		"username":     adminUser.Username,
		"is_admin":     adminUser.IsAdmin,
	})
}
