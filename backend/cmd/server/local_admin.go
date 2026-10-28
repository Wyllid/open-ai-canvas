package main

import (
	"log/slog"
	"os"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/service"
)

// ensureLocalAdmin keeps the single admin account in sync with CANVAS_ADMIN_USERNAME and
// CANVAS_ADMIN_PASSWORD (default admin/admin), so nobody has to register or verify an email.
func ensureLocalAdmin(svc *service.Service) error {
	creds := auth.LocalAdminCredentials{
		Username: env("CANVAS_ADMIN_USERNAME", "admin"),
		Password: os.Getenv("CANVAS_ADMIN_PASSWORD"),
	}
	if creds.Password == "" {
		creds.Password = "admin"
	}
	if auth.IsLocalAdminPassword(creds.Password) {
		slog.Warn("local admin uses the default password; set CANVAS_ADMIN_PASSWORD before exposing this server", "username", creds.Username)
	}
	user, err := svc.EnsureLocalAdmin(creds)
	if err != nil {
		return err
	}
	slog.Info("local admin ready", "username", user.Username)
	return nil
}
