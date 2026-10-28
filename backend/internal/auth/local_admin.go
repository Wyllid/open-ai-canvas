package auth

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// LocalAdminCredentials is the single account this fork uses instead of registration,
// email/SMS verification and third-party login. It comes from the environment.
type LocalAdminCredentials struct {
	Username string
	Password string
}

// EnsureLocalAdmin creates the admin account on first start and keeps its password,
// role and status in sync with the environment on every later start.
func (s *Service) EnsureLocalAdmin(creds LocalAdminCredentials) (*model.User, error) {
	username := NormalizeUsername(creds.Username)
	if username == "" {
		return nil, errors.New("local admin username is empty")
	}
	if creds.Password == "" {
		return nil, errors.New("local admin password is empty")
	}
	now := time.Now()
	user, err := s.repo.UserByUsername(username)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		hash, err := HashPassword(creds.Password)
		if err != nil {
			return nil, err
		}
		user = &model.User{
			ID:           kernel.NewID(),
			Username:     username,
			DisplayName:  username,
			Role:         model.UserRoleAdmin,
			Status:       model.UserStatusActive,
			PasswordHash: hash,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := s.repo.CreateRegisteredUser(user); err != nil {
			return nil, err
		}
		return user, nil
	}
	if err != nil {
		return nil, err
	}
	passwordChanged := !verifyPassword(creds.Password, user.PasswordHash)
	if !passwordChanged && user.Role == model.UserRoleAdmin && user.Status == model.UserStatusActive {
		return user, nil
	}
	if passwordChanged {
		hash, err := HashPassword(creds.Password)
		if err != nil {
			return nil, err
		}
		user.PasswordHash = hash
	}
	user.Role = model.UserRoleAdmin
	user.Status = model.UserStatusActive
	user.UpdatedAt = now
	if err := s.repo.SyncLocalAdmin(user, passwordChanged); err != nil {
		return nil, err
	}
	return user, nil
}

// LocalAdminPublicSettings tells the login page that only username/password sign-in exists.
func LocalAdminPublicSettings() *PublicAuthSettings {
	return &PublicAuthSettings{}
}

// IsLocalAdminPassword reports whether the configured password is the insecure default.
func IsLocalAdminPassword(value string) bool {
	return strings.TrimSpace(value) == "admin"
}
