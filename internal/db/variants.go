package db

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

const (
	RoleOriginal = "original"
	RoleThumb96  = "thumb_96"
)

type Variant struct {
	ImageID   string
	Role      string
	FileID    string
	MIMEType  string
	Width     int
	Height    int
	SizeBytes int64
}

// MIMEToExt maps a MIME type to a file extension.
func MIMEToExt(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	default:
		return "bin"
	}
}

// FileStorePath returns the filesystem path for a stored file.
func FileStorePath(dataDir, fileID, mimeType string) string {
	return filepath.Join(dataDir, "files", fileID+"."+MIMEToExt(mimeType))
}

func deleteFile(dataDir, fileID, mimeType string) {
	os.Remove(FileStorePath(dataDir, fileID, mimeType)) //nolint:errcheck
}

func InsertVariant(db *sql.DB, v *Variant) error {
	if v.FileID == "" {
		v.FileID = uuid.NewString()
	}
	_, err := db.Exec(
		`INSERT INTO image_variants (image_id, role, file_id, mime_type, width, height, size_bytes)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		v.ImageID, v.Role, v.FileID, v.MIMEType, v.Width, v.Height, v.SizeBytes,
	)
	return err
}

func GetVariantByFileID(db *sql.DB, fileID string) (*Variant, *Image, error) {
	row := db.QueryRow(
		`SELECT iv.image_id, iv.role, iv.file_id, iv.mime_type, iv.width, iv.height, iv.size_bytes,
		        i.id, i.uploader_id, i.orig_name, i.uploaded_at, i.expires_at
		 FROM image_variants iv
		 JOIN images i ON iv.image_id = i.id
		 WHERE iv.file_id = ?`,
		fileID,
	)
	var v Variant
	var img Image
	var uploadedAt, expiresAt int64
	err := row.Scan(
		&v.ImageID, &v.Role, &v.FileID, &v.MIMEType, &v.Width, &v.Height, &v.SizeBytes,
		&img.ID, &img.UploaderID, &img.OrigName, &uploadedAt, &expiresAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	img.UploadedAt = unixToTime(uploadedAt)
	img.ExpiresAt = unixToTime(expiresAt)
	return &v, &img, nil
}

func GetVariantsByImageID(db *sql.DB, imageID string) (map[string]*Variant, error) {
	rows, err := db.Query(
		`SELECT image_id, role, file_id, mime_type, width, height, size_bytes
		 FROM image_variants WHERE image_id = ?`,
		imageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*Variant)
	for rows.Next() {
		var v Variant
		if err := rows.Scan(&v.ImageID, &v.Role, &v.FileID, &v.MIMEType, &v.Width, &v.Height, &v.SizeBytes); err != nil {
			return nil, err
		}
		result[v.Role] = &v
	}
	return result, rows.Err()
}

func GetVariantsByImageIDs(db *sql.DB, imageIDs []string) (map[string]map[string]*Variant, error) {
	if len(imageIDs) == 0 {
		return nil, nil
	}
	placeholders := make([]byte, 0, len(imageIDs)*2)
	args := make([]any, len(imageIDs))
	for i, id := range imageIDs {
		if i > 0 {
			placeholders = append(placeholders, ',')
		}
		placeholders = append(placeholders, '?')
		args[i] = id
	}
	rows, err := db.Query(
		`SELECT image_id, role, file_id, mime_type, width, height, size_bytes
		 FROM image_variants WHERE image_id IN (`+string(placeholders)+`)`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]map[string]*Variant)
	for rows.Next() {
		var v Variant
		if err := rows.Scan(&v.ImageID, &v.Role, &v.FileID, &v.MIMEType, &v.Width, &v.Height, &v.SizeBytes); err != nil {
			return nil, err
		}
		if result[v.ImageID] == nil {
			result[v.ImageID] = make(map[string]*Variant)
		}
		result[v.ImageID][v.Role] = &v
	}
	return result, rows.Err()
}

func scanStringColumn(rows *sql.Rows) ([]string, error) {
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func unixToTime(ts int64) time.Time {
	return time.Unix(ts, 0).UTC()
}
