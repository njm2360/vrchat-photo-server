package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	appjwt "github.com/owner/vps/internal/jwt"
)

type contextKey int

const (
	userIDKey   contextKey = iota
	usernameKey contextKey = iota
	isAdminKey  contextKey = iota
)

const refreshTokenCookieName = "refresh_token"
const originalRefreshTokenCookieName = "original_refresh_token"

// OptionalAuth tries to validate the JWT but always calls next, injecting claims only if valid.
func OptionalAuth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if claims, err := verifyBearer(r, secret); err == nil {
				ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
				ctx = context.WithValue(ctx, usernameKey, claims.Username)
				ctx = context.WithValue(ctx, isAdminKey, claims.IsAdmin)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAuth validates the JWT in the Authorization header and injects claims into context.
func RequireAuth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, err := verifyBearer(r, secret)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
			ctx = context.WithValue(ctx, usernameKey, claims.Username)
			ctx = context.WithValue(ctx, isAdminKey, claims.IsAdmin)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAdmin is middleware that must be layered after RequireAuth.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !IsAdmin(r.Context()) {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func verifyBearer(r *http.Request, secret []byte) (*appjwt.Claims, error) {
	auth := r.Header.Get("Authorization")
	token := strings.TrimPrefix(auth, "Bearer ")
	if token == "" || token == auth {
		return nil, http.ErrNoCookie
	}
	return appjwt.Verify(token, secret)
}

// UserID returns the authenticated user ID from context.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

// Username returns the authenticated username from context.
func Username(ctx context.Context) string {
	v, _ := ctx.Value(usernameKey).(string)
	return v
}

// IsAdmin returns true if the authenticated user is an admin.
func IsAdmin(ctx context.Context) bool {
	v, _ := ctx.Value(isAdminKey).(bool)
	return v
}

// SetRefreshTokenCookie writes the refresh_token cookie.
func SetRefreshTokenCookie(w http.ResponseWriter, tokenID string, expiresAt time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    tokenID,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
}

// ClearRefreshTokenCookie expires the refresh_token cookie.
func ClearRefreshTokenCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshTokenCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// RefreshTokenIDFromRequest reads the refresh_token cookie value.
func RefreshTokenIDFromRequest(r *http.Request) string {
	c, err := r.Cookie(refreshTokenCookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

// SetOriginalRefreshTokenCookie stores the admin's refresh token before impersonation.
func SetOriginalRefreshTokenCookie(w http.ResponseWriter, tokenID string, expiresAt time.Time, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     originalRefreshTokenCookieName,
		Value:    tokenID,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
}

// ClearOriginalRefreshTokenCookie removes the original_refresh_token cookie.
func ClearOriginalRefreshTokenCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     originalRefreshTokenCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// OriginalRefreshTokenIDFromRequest reads the original_refresh_token cookie value.
func OriginalRefreshTokenIDFromRequest(r *http.Request) string {
	c, err := r.Cookie(originalRefreshTokenCookieName)
	if err != nil {
		return ""
	}
	return c.Value
}
