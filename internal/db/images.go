package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Image struct {
	ID         string
	UploaderID string
	OrigName   string
	UploadedAt time.Time
	ExpiresAt  time.Time
}

func InsertImage(db *sql.DB, uploaderID, origName string, expiresAt time.Time) (*Image, error) {
	img := &Image{
		ID:         uuid.NewString(),
		UploaderID: uploaderID,
		OrigName:   origName,
		UploadedAt: time.Now().UTC(),
		ExpiresAt:  expiresAt,
	}
	_, err := db.Exec(
		`INSERT INTO images (id, uploader_id, orig_name, uploaded_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
		img.ID, img.UploaderID, img.OrigName, img.UploadedAt.Unix(), img.ExpiresAt.Unix(),
	)
	return img, err
}

func GetImage(db *sql.DB, id string) (*Image, error) {
	row := db.QueryRow(
		`SELECT id, uploader_id, orig_name, uploaded_at, expires_at FROM images WHERE id = ?`,
		id,
	)
	return scanImage(row)
}

type ListImagesParams struct {
	UploaderID string
	Limit      int
	Offset     int
	Sort       string // "uploaded_at" | "expires_at" | "filename" | "size_bytes"
	Order      string // "asc" | "desc"
	Expired    *bool  // nil=全て, true=期限切れのみ, false=有効のみ
	Filename   string // orig_name の部分一致
}

var validSortCols = map[string]string{
	"uploaded_at": "i.uploaded_at",
	"expires_at":  "i.expires_at",
	"filename":    "i.orig_name",
	"size_bytes":  "COALESCE(v.size_bytes, 0)",
}

func ListImages(db *sql.DB, p ListImagesParams) ([]Image, int, error) {
	sortCol := "i.uploaded_at"
	if col, ok := validSortCols[p.Sort]; ok {
		sortCol = col
	}
	order := "DESC"
	if p.Order == "asc" {
		order = "ASC"
	}

	args := []any{p.UploaderID}
	cond := "WHERE i.uploader_id = ?"

	if p.Filename != "" {
		cond += " AND i.orig_name LIKE ? ESCAPE '\\'"
		args = append(args, "%"+escapeLike(p.Filename)+"%")
	}
	if p.Expired != nil {
		if *p.Expired {
			cond += " AND i.expires_at < unixepoch()"
		} else {
			cond += " AND i.expires_at >= unixepoch()"
		}
	}

	var total int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM images i "+cond, args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := make([]any, len(args)+2)
	copy(listArgs, args)
	listArgs[len(args)] = p.Limit
	listArgs[len(args)+1] = p.Offset

	rows, err := db.Query(fmt.Sprintf(`
		SELECT i.id, i.uploader_id, i.orig_name, i.uploaded_at, i.expires_at
		  FROM images i
		  LEFT JOIN image_variants v ON v.image_id = i.id AND v.role = 'original'
		  %s
		  ORDER BY %s %s
		  LIMIT ? OFFSET ?`, cond, sortCol, order),
		listArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var imgs []Image
	for rows.Next() {
		img, err := scanImageRow(rows)
		if err != nil {
			return nil, 0, err
		}
		imgs = append(imgs, *img)
	}
	return imgs, total, rows.Err()
}

func DeleteImage(db *sql.DB, id, uploaderID string) (bool, error) {
	res, err := db.Exec(
		`DELETE FROM images WHERE id = ? AND uploader_id = ?`, id, uploaderID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteExpiredImages deletes files for expired images and removes DB rows
// that have been expired for more than graceSeconds.
func DeleteExpiredImages(db *sql.DB, dataDir string, gracePeriod time.Duration) error {
	now := time.Now().Unix()

	// Delete files for expired images.
	rows, err := db.Query(
		`SELECT iv.file_id, iv.mime_type FROM image_variants iv
		 JOIN images i ON iv.image_id = i.id
		 WHERE i.expires_at < ?`,
		now,
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

	// Remove DB rows past the grace period (CASCADE deletes variants).
	_, err = db.Exec(
		`DELETE FROM images WHERE expires_at < ?`,
		time.Now().Add(-gracePeriod).Unix(),
	)
	return err
}

func DeleteUserImages(sqlDB *sql.DB, dataDir, userID string) error {
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
	_, err = sqlDB.Exec(`DELETE FROM images WHERE uploader_id = ?`, userID)
	return err
}

func scanImage(row *sql.Row) (*Image, error) {
	var img Image
	var uploadedAt, expiresAt int64
	if err := row.Scan(&img.ID, &img.UploaderID, &img.OrigName, &uploadedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	img.UploadedAt = unixToTime(uploadedAt)
	img.ExpiresAt = unixToTime(expiresAt)
	return &img, nil
}

func scanImageRow(rows *sql.Rows) (*Image, error) {
	var img Image
	var uploadedAt, expiresAt int64
	if err := rows.Scan(&img.ID, &img.UploaderID, &img.OrigName, &uploadedAt, &expiresAt); err != nil {
		return nil, err
	}
	img.UploadedAt = unixToTime(uploadedAt)
	img.ExpiresAt = unixToTime(expiresAt)
	return &img, nil
}
