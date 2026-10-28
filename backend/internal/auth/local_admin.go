package auth

import (
	"encoding/json"
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

// localAdminSettingKey remembers which account is the local admin, so renaming
// CANVAS_ADMIN_USERNAME retires the old account instead of leaving it signed in.
const localAdminSettingKey = "local_admin"

type localAdminBinding struct {
	UserID string `json:"userId"`
}

// EnsureLocalAdmin creates the admin account on first start and keeps its password,
// role and status in sync with the environment on every later start. When the
// configured username changes, the previous local admin is disabled and signed out.
func (s *Service) EnsureLocalAdmin(creds LocalAdminCredentials) (*model.User, error) {
	user, err := s.ensureLocalAdminAccount(creds)
	if err != nil {
		return nil, err
	}
	if err := s.retirePreviousLocalAdmin(user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) retirePreviousLocalAdmin(user *model.User) error {
	setting, err := s.repo.SystemSettingOptional(localAdminSettingKey)
	if err != nil {
		return err
	}
	var binding localAdminBinding
	if setting != nil {
		_ = json.Unmarshal([]byte(setting.ValueJSON), &binding)
	}
	if binding.UserID == user.ID {
		return nil
	}
	if binding.UserID != "" {
		previous, err := s.repo.User(binding.UserID)
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
		case err != nil:
			return err
		case previous.Role == model.UserRoleAdmin || previous.Status == model.UserStatusActive:
			previous.Role, previous.Status, previous.UpdatedAt = model.UserRoleUser, model.UserStatusDisabled, time.Now()
			if err := s.repo.SyncLocalAdmin(previous, true); err != nil {
				return err
			}
		}
	}
	encoded, err := json.Marshal(localAdminBinding{UserID: user.ID})
	if err != nil {
		return err
	}
	now := time.Now()
	next := &model.SystemSetting{Key: localAdminSettingKey, ValueJSON: string(encoded), UpdatedBy: user.ID, CreatedAt: now, UpdatedAt: now}
	if setting != nil {
		next.CreatedAt = setting.CreatedAt
	}
	return s.repo.SaveSystemSetting(next)
}

func (s *Service) ensureLocalAdminAccount(creds LocalAdminCredentials) (*model.User, error) {
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
