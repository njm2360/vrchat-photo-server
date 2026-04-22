package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

func Open(dataDir string) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "files"), 0o755); err != nil {
		return nil, fmt.Errorf("create files dir: %w", err)
	}

	db, err := sql.Open("sqlite", filepath.Join(dataDir, "server.db"))
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		return nil, fmt.Errorf("set WAL: %w", err)
	}
	if _, err := db.Exec(`PRAGMA synchronous=NORMAL`); err != nil {
		return nil, fmt.Errorf("set synchronous: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			username      TEXT UNIQUE NOT NULL,
			pass_hash     TEXT NOT NULL,
			created_at    INTEGER NOT NULL,
			is_admin      INTEGER NOT NULL DEFAULT 0,
			is_disabled   INTEGER NOT NULL DEFAULT 0,
			last_login_at INTEGER
		)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at)`,
		`CREATE TABLE IF NOT EXISTS images (
			id          TEXT PRIMARY KEY,
			uploader_id TEXT NOT NULL REFERENCES users(id),
			orig_name   TEXT NOT NULL,
			uploaded_at INTEGER NOT NULL,
			expires_at  INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_images_uploader_at ON images(uploader_id, uploaded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_images_expires     ON images(expires_at)`,
		`CREATE TABLE IF NOT EXISTS image_variants (
			image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
			role       TEXT NOT NULL,
			file_id    TEXT NOT NULL UNIQUE,
			mime_type  TEXT NOT NULL,
			width      INTEGER NOT NULL,
			height     INTEGER NOT NULL,
			size_bytes INTEGER NOT NULL,
			PRIMARY KEY (image_id, role)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_variants_file_id ON image_variants(file_id)`,
		`CREATE TABLE IF NOT EXISTS proxy_cache (
			url        TEXT PRIMARY KEY,
			file_id    TEXT NOT NULL UNIQUE,
			cached_at  INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_proxy_expires ON proxy_cache(expires_at)`,
		`CREATE TABLE IF NOT EXISTS proxy_allowed_hosts (
			id         TEXT PRIMARY KEY,
			pattern    TEXT NOT NULL UNIQUE,
			note       TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			created_by TEXT NOT NULL REFERENCES users(id),
			updated_at INTEGER NOT NULL,
			updated_by TEXT NOT NULL REFERENCES users(id),
			enabled    INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE INDEX IF NOT EXISTS idx_proxy_hosts_enabled ON proxy_allowed_hosts(enabled, pattern)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("exec %q: %w", s[:min(40, len(s))], err)
		}
	}
	return nil
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}
