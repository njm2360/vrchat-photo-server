package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type ProxyAllowedHost struct {
	ID        string
	Pattern   string
	Note      string
	CreatedAt time.Time
	CreatedBy string
	UpdatedAt time.Time
	UpdatedBy string
	Enabled   bool
}

type ProxyAllowedHostRow struct {
	ProxyAllowedHost
	CreatedByUsername string
	UpdatedByUsername string
}

type ListProxyAllowedHostsParams struct {
	Pattern string
	Limit   int
	Offset  int
}

// GetEnabledProxyHostPatterns returns only the patterns of enabled hosts.
// Used by the proxy handler on each unauthenticated, uncached request.
func GetEnabledProxyHostPatterns(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT pattern FROM proxy_allowed_hosts WHERE enabled = 1`)
	if err != nil {
		return nil, err
	}
	return scanStringColumn(rows)
}

func ListProxyAllowedHosts(db *sql.DB, p ListProxyAllowedHostsParams) ([]ProxyAllowedHostRow, int, error) {
	var args []any
	cond := ""
	if p.Pattern != "" {
		cond = "WHERE h.pattern LIKE ? ESCAPE '\\'"
		args = append(args, "%"+escapeLike(p.Pattern)+"%")
	}

	var total int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM proxy_allowed_hosts h "+cond, args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := make([]any, len(args)+2)
	copy(listArgs, args)
	listArgs[len(args)] = p.Limit
	listArgs[len(args)+1] = p.Offset

	rows, err := db.Query(fmt.Sprintf(`
		SELECT h.id, h.pattern, h.note,
		       h.created_at, h.created_by, uc.username,
		       h.updated_at, h.updated_by, uu.username,
		       h.enabled
		  FROM proxy_allowed_hosts h
		  JOIN users uc ON uc.id = h.created_by
		  JOIN users uu ON uu.id = h.updated_by
		  %s
		  ORDER BY h.created_at DESC
		  LIMIT ? OFFSET ?`, cond),
		listArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []ProxyAllowedHostRow
	for rows.Next() {
		var r ProxyAllowedHostRow
		var createdAt, updatedAt int64
		var enabled int
		if err := rows.Scan(
			&r.ID, &r.Pattern, &r.Note,
			&createdAt, &r.CreatedBy, &r.CreatedByUsername,
			&updatedAt, &r.UpdatedBy, &r.UpdatedByUsername,
			&enabled,
		); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = unixToTime(createdAt)
		r.UpdatedAt = unixToTime(updatedAt)
		r.Enabled = enabled != 0
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func AddProxyAllowedHost(db *sql.DB, pattern, note, createdByID string) (*ProxyAllowedHost, error) {
	now := time.Now().UTC()
	h := &ProxyAllowedHost{
		ID:        uuid.NewString(),
		Pattern:   pattern,
		Note:      note,
		CreatedAt: now,
		CreatedBy: createdByID,
		UpdatedAt: now,
		UpdatedBy: createdByID,
		Enabled:   true,
	}
	_, err := db.Exec(
		`INSERT INTO proxy_allowed_hosts (id, pattern, note, created_at, created_by, updated_at, updated_by, enabled)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
		h.ID, h.Pattern, h.Note, h.CreatedAt.Unix(), h.CreatedBy, h.UpdatedAt.Unix(), h.UpdatedBy,
	)
	if err != nil {
		return nil, err
	}
	return h, nil
}

func DeleteProxyAllowedHost(db *sql.DB, id string) (bool, error) {
	res, err := db.Exec(`DELETE FROM proxy_allowed_hosts WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func SetProxyAllowedHostEnabled(db *sql.DB, id string, enabled bool, updatedByID string) (bool, error) {
	v := 0
	if enabled {
		v = 1
	}
	res, err := db.Exec(
		`UPDATE proxy_allowed_hosts SET enabled = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
		v, time.Now().UTC().Unix(), updatedByID, id,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func UpdateProxyAllowedHostNote(db *sql.DB, id, note, updatedByID string) (bool, error) {
	res, err := db.Exec(
		`UPDATE proxy_allowed_hosts SET note = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
		note, time.Now().UTC().Unix(), updatedByID, id,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func GetProxyAllowedHostByID(db *sql.DB, id string) (*ProxyAllowedHost, error) {
	row := db.QueryRow(
		`SELECT id, pattern, note, created_at, created_by, updated_at, updated_by, enabled
		 FROM proxy_allowed_hosts WHERE id = ?`, id,
	)
	var h ProxyAllowedHost
	var createdAt, updatedAt int64
	var enabled int
	if err := row.Scan(&h.ID, &h.Pattern, &h.Note, &createdAt, &h.CreatedBy, &updatedAt, &h.UpdatedBy, &enabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	h.CreatedAt = unixToTime(createdAt)
	h.UpdatedAt = unixToTime(updatedAt)
	h.Enabled = enabled != 0
	return &h, nil
}
