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
	if auth.IsWeakAdminPassword(creds.Password) {
		slog.Warn("local admin password is the default or shorter than 12 characters; sign-in is limited to this machine and private networks until CANVAS_ADMIN_PASSWORD is strong", "username", creds.Username)
	}
	user, err := svc.EnsureLocalAdmin(creds)
	if err != nil {
		return err
	}
	slog.Info("local admin ready", "username", user.Username)
	return nil
}
