package db

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

const RefreshTokenTTL = 30 * 24 * time.Hour

type RefreshToken struct {
	ID        string
	UserID    string
	CreatedAt time.Time
	ExpiresAt time.Time
}

func CreateRefreshToken(db *sql.DB, userID string) (*RefreshToken, error) {
	now := time.Now().UTC()
	t := &RefreshToken{
		ID:        uuid.NewString(),
		UserID:    userID,
		CreatedAt: now,
		ExpiresAt: now.Add(RefreshTokenTTL),
	}
	_, err := db.Exec(
		`INSERT INTO refresh_tokens (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		t.ID, t.UserID, t.CreatedAt.Unix(), t.ExpiresAt.Unix(),
	)
	return t, err
}

func GetRefreshToken(db *sql.DB, id string) (*RefreshToken, error) {
	row := db.QueryRow(
		`SELECT id, user_id, created_at, expires_at FROM refresh_tokens WHERE id = ? AND expires_at > ?`,
		id, time.Now().Unix(),
	)
	var t RefreshToken
	var createdAt, expiresAt int64
	if err := row.Scan(&t.ID, &t.UserID, &createdAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	t.CreatedAt = time.Unix(createdAt, 0).UTC()
	t.ExpiresAt = time.Unix(expiresAt, 0).UTC()
	return &t, nil
}

func DeleteRefreshToken(db *sql.DB, id string) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE id = ?`, id)
	return err
}

func DeleteRefreshTokensByUserID(db *sql.DB, userID string) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID)
	return err
}

func DeleteExpiredRefreshTokens(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM refresh_tokens WHERE expires_at < ?`, time.Now().Unix())
	return err
}
