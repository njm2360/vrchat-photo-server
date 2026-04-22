package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID          string
	Username    string
	PassHash    string
	CreatedAt   time.Time
	IsAdmin     bool
	IsDisabled  bool
	LastLoginAt *time.Time
}

type UserSummary struct {
	ID           string
	Username     string
	IsAdmin      bool
	IsDisabled   bool
	CreatedAt    time.Time
	LastLoginAt  *time.Time
	ImageCount   int
	StorageBytes int64
}

func GetUser(db *sql.DB, username string) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, pass_hash, created_at, is_admin, is_disabled, last_login_at
		 FROM users WHERE username = ?`,
		username,
	)
	return scanUser(row.Scan)
}

func GetUserByID(db *sql.DB, id string) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, pass_hash, created_at, is_admin, is_disabled, last_login_at
		 FROM users WHERE id = ?`,
		id,
	)
	return scanUser(row.Scan)
}

func scanUser(scan func(...any) error) (*User, error) {
	var u User
	var createdAt int64
	var isAdminInt, isDisabledInt int
	var lastLoginAt sql.NullInt64
	err := scan(&u.ID, &u.Username, &u.PassHash, &createdAt, &isAdminInt, &isDisabledInt, &lastLoginAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	u.CreatedAt = time.Unix(createdAt, 0).UTC()
	u.IsAdmin = isAdminInt == 1
	u.IsDisabled = isDisabledInt == 1
	if lastLoginAt.Valid {
		t := time.Unix(lastLoginAt.Int64, 0).UTC()
		u.LastLoginAt = &t
	}
	return &u, nil
}

func CreateUser(db *sql.DB, username, passHash string, isAdmin bool) error {
	isAdminInt := 0
	if isAdmin {
		isAdminInt = 1
	}
	_, err := db.Exec(
		`INSERT INTO users (id, username, pass_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)`,
		uuid.NewString(),
		username,
		passHash,
		time.Now().Unix(),
		isAdminInt,
	)
	return err
}

type ListUsersParams struct {
	Limit  int
	Offset int
	Search string // partial match on username
	Role   string // "admin" | "user" | "" = all
	Status string // "active" | "disabled" | "" = all
	Sort   string // "username" | "created_at" | "last_login_at" | "image_count" | "storage_bytes"
	Order  string // "asc" | "desc"
}

var validUserSortCols = map[string]string{
	"username":      "u.username",
	"created_at":    "u.created_at",
	"last_login_at": "COALESCE(u.last_login_at, 0)",
	"image_count":   "COUNT(DISTINCT i.id)",
	"storage_bytes": "COALESCE(SUM(iv.size_bytes), 0)",
}

func ListUsers(db *sql.DB, p ListUsersParams) ([]UserSummary, int, error) {
	sortCol := "u.created_at"
	if col, ok := validUserSortCols[p.Sort]; ok {
		sortCol = col
	}
	dir := "ASC"
	if p.Order == "desc" {
		dir = "DESC"
	}

	var args []any
	cond := "WHERE 1=1"
	if p.Search != "" {
		cond += " AND u.username LIKE ? ESCAPE '\\'"
		args = append(args, "%"+escapeLike(p.Search)+"%")
	}
	if p.Role == "admin" {
		cond += " AND u.is_admin = 1"
	} else if p.Role == "user" {
		cond += " AND u.is_admin = 0"
	}
	if p.Status == "active" {
		cond += " AND u.is_disabled = 0"
	} else if p.Status == "disabled" {
		cond += " AND u.is_disabled = 1"
	}

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM users u "+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := make([]any, len(args)+2)
	copy(listArgs, args)
	listArgs[len(args)] = p.Limit
	listArgs[len(args)+1] = p.Offset

	rows, err := db.Query(fmt.Sprintf(`
		SELECT u.id, u.username, u.is_admin, u.is_disabled, u.created_at, u.last_login_at,
		       COUNT(DISTINCT i.id), COALESCE(SUM(iv.size_bytes), 0)
		  FROM users u
		  LEFT JOIN images i ON i.uploader_id = u.id
		  LEFT JOIN image_variants iv ON iv.image_id = i.id AND iv.role = 'original'
		  %s
		  GROUP BY u.id
		  ORDER BY %s %s
		  LIMIT ? OFFSET ?`, cond, sortCol, dir),
		listArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []UserSummary
	for rows.Next() {
		var s UserSummary
		var createdAt int64
		var isAdminInt, isDisabledInt int
		var lastLoginAt sql.NullInt64
		if err := rows.Scan(&s.ID, &s.Username, &isAdminInt, &isDisabledInt, &createdAt, &lastLoginAt, &s.ImageCount, &s.StorageBytes); err != nil {
			return nil, 0, err
		}
		s.IsAdmin = isAdminInt == 1
		s.IsDisabled = isDisabledInt == 1
		s.CreatedAt = time.Unix(createdAt, 0).UTC()
		if lastLoginAt.Valid {
			t := time.Unix(lastLoginAt.Int64, 0).UTC()
			s.LastLoginAt = &t
		}
		out = append(out, s)
	}
	return out, total, rows.Err()
}

func UpdatePassword(db *sql.DB, userID, passHash string) error {
	_, err := db.Exec(`UPDATE users SET pass_hash = ? WHERE id = ?`, passHash, userID)
	return err
}

func UpdateLastLogin(db *sql.DB, userID string) error {
	_, err := db.Exec(`UPDATE users SET last_login_at = ? WHERE id = ?`, time.Now().Unix(), userID)
	return err
}

func RenameUser(db *sql.DB, userID, newUsername string) error {
	_, err := db.Exec(`UPDATE users SET username = ? WHERE id = ?`, newUsername, userID)
	return err
}

func SetDisabled(db *sql.DB, userID string, disabled bool) error {
	v := 0
	if disabled {
		v = 1
	}
	_, err := db.Exec(`UPDATE users SET is_disabled = ? WHERE id = ?`, v, userID)
	return err
}

func SetAdmin(db *sql.DB, userID string, isAdmin bool) error {
	v := 0
	if isAdmin {
		v = 1
	}
	_, err := db.Exec(`UPDATE users SET is_admin = ? WHERE id = ?`, v, userID)
	return err
}

// DeleteUser removes a user and all their images (with files) from the system.
func DeleteUser(sqlDB *sql.DB, dataDir, userID string) error {
	rows, err := sqlDB.Query(
		`SELECT iv.file_id, iv.mime_type FROM image_variants iv
		 JOIN images i ON iv.image_id = i.id
		 WHERE i.uploader_id = ?`,
		userID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var fileID, mimeType string
		if err := rows.Scan(&fileID, &mimeType); err != nil {
			return err
		}
		deleteFile(dataDir, fileID, mimeType)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if _, err := sqlDB.Exec(`DELETE FROM images WHERE uploader_id = ?`, userID); err != nil {
		return err
	}
	_, err = sqlDB.Exec(`DELETE FROM users WHERE id = ?`, userID)
	return err
}

func CountUsers(db *sql.DB) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func AdminCount(db *sql.DB) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin = 1`).Scan(&n)
	return n, err
}
