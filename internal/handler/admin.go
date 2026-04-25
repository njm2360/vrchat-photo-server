package handler

import (
	"database/sql"
)

type AdminHandler struct {
	db           *sql.DB
	dataDir      string
	jwtSecret    []byte
	secureCookie bool
}

func NewAdminHandler(sqlDB *sql.DB, dataDir string, jwtSecret []byte, secureCookie bool) *AdminHandler {
	return &AdminHandler{db: sqlDB, dataDir: dataDir, jwtSecret: jwtSecret, secureCookie: secureCookie}
}
