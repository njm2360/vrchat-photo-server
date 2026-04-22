package db

import (
	"database/sql"
	"errors"
	"os"
	"time"

	"github.com/google/uuid"
)

const ProxyCacheTTL = 24 * time.Hour

type ProxyCache struct {
	URL       string
	FileID    string
	CachedAt  time.Time
	ExpiresAt time.Time
}

func GetProxyCache(db *sql.DB, url string) (*ProxyCache, error) {
	row := db.QueryRow(
		`SELECT url, file_id, cached_at, expires_at FROM proxy_cache WHERE url = ? AND expires_at > ?`,
		url, time.Now().Unix(),
	)
	var p ProxyCache
	var cachedAt, expiresAt int64
	if err := row.Scan(&p.URL, &p.FileID, &cachedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	p.CachedAt = unixToTime(cachedAt)
	p.ExpiresAt = unixToTime(expiresAt)
	return &p, nil
}

func UpsertProxyCache(db *sql.DB, url string) (*ProxyCache, string, error) {
	var oldFileID string
	db.QueryRow(`SELECT file_id FROM proxy_cache WHERE url = ?`, url).Scan(&oldFileID) //nolint:errcheck

	now := time.Now().UTC()
	p := &ProxyCache{
		URL:       url,
		FileID:    uuid.NewString(),
		CachedAt:  now,
		ExpiresAt: now.Add(ProxyCacheTTL),
	}
	_, err := db.Exec(
		`INSERT INTO proxy_cache (url, file_id, cached_at, expires_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(url) DO UPDATE SET file_id=excluded.file_id, cached_at=excluded.cached_at, expires_at=excluded.expires_at`,
		p.URL, p.FileID, p.CachedAt.Unix(), p.ExpiresAt.Unix(),
	)
	if err != nil {
		return nil, "", err
	}
	return p, oldFileID, nil
}

func GetProxyCacheByFileID(db *sql.DB, fileID string) (*ProxyCache, error) {
	row := db.QueryRow(
		`SELECT url, file_id, cached_at, expires_at FROM proxy_cache WHERE file_id = ?`,
		fileID,
	)
	var p ProxyCache
	var cachedAt, expiresAt int64
	if err := row.Scan(&p.URL, &p.FileID, &cachedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	p.CachedAt = unixToTime(cachedAt)
	p.ExpiresAt = unixToTime(expiresAt)
	return &p, nil
}

type ListProxyCacheParams struct {
	URL    string
	Limit  int
	Offset int
	Sort   string // "url" | "cached_at" | "expires_at"
	Order  string // "asc" | "desc"
}

var validProxySortCols = map[string]string{
	"url":        "url",
	"cached_at":  "cached_at",
	"expires_at": "expires_at",
}

func ListProxyCache(db *sql.DB, p ListProxyCacheParams) ([]ProxyCache, int, error) {
	sortCol := "cached_at"
	if col, ok := validProxySortCols[p.Sort]; ok {
		sortCol = col
	}
	order := "DESC"
	if p.Order == "asc" {
		order = "ASC"
	}

	var args []any
	cond := ""
	if p.URL != "" {
		cond = "WHERE url LIKE ? ESCAPE '\\'"
		args = append(args, "%"+escapeLike(p.URL)+"%")
	}

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM proxy_cache "+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := make([]any, len(args)+2)
	copy(listArgs, args)
	listArgs[len(args)] = p.Limit
	listArgs[len(args)+1] = p.Offset

	rows, err := db.Query(
		"SELECT url, file_id, cached_at, expires_at FROM proxy_cache "+cond+
			" ORDER BY "+sortCol+" "+order+" LIMIT ? OFFSET ?",
		listArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []ProxyCache
	for rows.Next() {
		var p ProxyCache
		var cachedAt, expiresAt int64
		if err := rows.Scan(&p.URL, &p.FileID, &cachedAt, &expiresAt); err != nil {
			return nil, 0, err
		}
		p.CachedAt = unixToTime(cachedAt)
		p.ExpiresAt = unixToTime(expiresAt)
		entries = append(entries, p)
	}
	return entries, total, rows.Err()
}

func DeleteProxyCacheEntry(db *sql.DB, dataDir, url string) (bool, error) {
	var fileID string
	err := db.QueryRow(`SELECT file_id FROM proxy_cache WHERE url = ?`, url).Scan(&fileID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	res, err := db.Exec(`DELETE FROM proxy_cache WHERE url = ?`, url)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		os.Remove(FileStorePath(dataDir, fileID, "image/png")) //nolint:errcheck
	}
	return n > 0, nil
}

func DeleteExpiredProxy(db *sql.DB, dataDir string) error {
	rows, err := db.Query(
		`SELECT file_id FROM proxy_cache WHERE expires_at < ?`, time.Now().Unix(),
	)
	if err != nil {
		return err
	}
	fileIDs, err := scanStringColumn(rows)
	if err != nil {
		return err
	}
	for _, id := range fileIDs {
		deleteFile(dataDir, id, "image/png")
	}

	_, err = db.Exec(`DELETE FROM proxy_cache WHERE expires_at < ?`, time.Now().Unix())
	return err
}
