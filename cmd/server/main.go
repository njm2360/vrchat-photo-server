package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"golang.org/x/crypto/bcrypt"

	"github.com/owner/vps/internal/db"
	"github.com/owner/vps/internal/handler"
	"github.com/owner/vps/internal/middleware"
	"github.com/owner/vps/internal/ratelimit"
)

func main() {
	baseURL := getEnv("BASE_URL", "http://localhost:8000")
	dataDir := getEnv("DATA_DIR", "./data")

	jwtSecret := loadJWTSecret()
	secureCookie := strings.HasPrefix(baseURL, "https://")

	sqlDB, err := db.Open(dataDir)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer sqlDB.Close()

	if err := ensureAdminUser(sqlDB); err != nil {
		log.Fatalf("ensure admin user: %v", err)
	}

	loginLimiter := ratelimit.New(5, 900*time.Second)
	loginIPLimiter := ratelimit.New(20, 900*time.Second)
	proxyLimiter := ratelimit.New(30, 60*time.Second)

	authH := handler.NewAuthHandler(sqlDB, jwtSecret, loginLimiter, loginIPLimiter, secureCookie)
	imagesH := handler.NewImagesHandler(sqlDB, dataDir, baseURL)
	filesH := handler.NewFilesHandler(sqlDB, dataDir)
	proxyH := handler.NewProxyHandler(sqlDB, dataDir, proxyLimiter)
	adminH := handler.NewAdminHandler(sqlDB, dataDir, jwtSecret, secureCookie)
	profileH := handler.NewProfileHandler(sqlDB)

	trustedProxies, err := middleware.ParseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		log.Fatalf("TRUSTED_PROXIES: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.NewRealIP(trustedProxies))
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	// Auth endpoints (no auth required).
	r.Post("/api/auth/login", authH.Login)
	r.Post("/api/auth/logout", authH.Logout)
	r.Post("/api/auth/refresh", authH.Refresh)

	// Authenticated endpoints.
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(jwtSecret))
		r.Get("/api/auth/me", authH.Me)
		r.Post("/api/auth/impersonation/exit", authH.ExitImpersonation)
		r.Post("/api/images", imagesH.Upload)
		r.Get("/api/images", imagesH.List)
		r.Delete("/api/images/{id}", imagesH.Delete)
		r.Put("/api/profile/username", profileH.RenameUsername)
		r.Put("/api/profile/password", profileH.ChangePassword)
	})

	// Admin-only endpoints.
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(jwtSecret))
		r.Use(middleware.RequireAdmin)
		r.Get("/api/admin/users", adminH.ListUsers)
		r.Get("/api/admin/users/check", adminH.CheckUsername)
		r.Post("/api/admin/users", adminH.CreateUser)
		r.Delete("/api/admin/users/{id}", adminH.DeleteUser)
		r.Put("/api/admin/users/{id}/password", adminH.ResetPassword)
		r.Put("/api/admin/users/{id}/admin", adminH.SetAdmin)
		r.Put("/api/admin/users/{id}/username", adminH.RenameUser)
		r.Put("/api/admin/users/{id}/disabled", adminH.SetDisabled)
		r.Post("/api/admin/users/{id}/impersonate", adminH.Impersonate)
		r.Delete("/api/admin/users/{id}/sessions", adminH.RevokeUserSessions)
		r.Get("/api/admin/users/{id}/images", imagesH.ListForAdmin)
		r.Delete("/api/admin/users/{id}/images", adminH.DeleteUserImages)
		r.Delete("/api/admin/images/{id}", imagesH.DeleteForAdmin)
		r.Get("/api/admin/proxy/hosts/check", adminH.CheckProxyHost)
		r.Get("/api/admin/proxy/hosts", adminH.ListProxyHosts)
		r.Post("/api/admin/proxy/hosts", adminH.CreateProxyHost)
		r.Delete("/api/admin/proxy/hosts/{id}", adminH.DeleteProxyHost)
		r.Put("/api/admin/proxy/hosts/{id}/enabled", adminH.SetProxyHostEnabled)
		r.Put("/api/admin/proxy/hosts/{id}/note", adminH.UpdateProxyHostNote)
		r.Get("/api/admin/proxy/cache", adminH.ListProxyCache)
		r.Delete("/api/admin/proxy/cache", adminH.DeleteProxyCache)
	})

	// Proxy: unauthenticated requests enforce PROXY_ALLOWED_HOSTS; authenticated users bypass it.
	r.With(middleware.OptionalAuth(jwtSecret)).Get("/api/proxy", proxyH.Proxy)

	// File serving (no auth required).
	r.Get("/files/{fileID}", filesH.ServeFile)

	// SPA: serve frontend/dist/ for all non-API, non-file routes.
	r.Handle("/*", spaHandler("frontend/dist"))

	// Background cleanup goroutines.
	go cleanupLoop("expired images", 60*time.Second, func() error {
		return db.DeleteExpiredImages(sqlDB, dataDir, 30*24*time.Hour)
	})
	go cleanupLoop("expired proxy cache", 3600*time.Second, func() error {
		return db.DeleteExpiredProxy(sqlDB, dataDir)
	})
	go cleanupLoop("expired refresh tokens", 3600*time.Second, func() error {
		return db.DeleteExpiredRefreshTokens(sqlDB)
	})

	srv := &http.Server{
		Addr:         ":8000",
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func loadJWTSecret() []byte {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		return []byte(s)
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		log.Fatalf("generate jwt secret: %v", err)
	}
	log.Printf("warning: JWT_SECRET not set, using random secret (sessions will not survive restart)")
	return secret
}

type noListFS struct{ http.FileSystem }

func (fs noListFS) Open(name string) (http.File, error) {
	f, err := fs.FileSystem.Open(name)
	if err != nil {
		return nil, err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if stat.IsDir() {
		f.Close()
		return nil, &os.PathError{Op: "open", Path: name, Err: os.ErrNotExist}
	}
	return f, nil
}

func spaHandler(dir string) http.Handler {
	fs := http.Dir(dir)
	fileServer := http.FileServer(noListFS{fs})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := fs.Open(r.URL.Path)
		if err == nil {
			stat, statErr := f.Stat()
			f.Close()
			if statErr == nil && !stat.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		http.ServeFile(w, r, dir+"/index.html")
	})
}

func ensureAdminUser(sqlDB *sql.DB) error {
	n, err := db.CountUsers(sqlDB)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	password := base64.RawURLEncoding.EncodeToString(raw)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := db.CreateUser(sqlDB, "admin", string(hash), true); err != nil {
		return err
	}
	log.Printf("created initial admin user — username: admin  password: %s", password)
	return nil
}

func cleanupLoop(name string, interval time.Duration, fn func() error) {
	time.Sleep(time.Second)
	for {
		if err := fn(); err != nil {
			log.Printf("cleanup %s: %v", name, err)
		}
		time.Sleep(interval)
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
