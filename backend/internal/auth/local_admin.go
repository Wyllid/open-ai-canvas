package auth

import (
	"encoding/json"
	"errors"
	"net"
	"strings"
	"time"
	"unicode/utf8"

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
	// WeakPassword limits sign-in to loopback and private networks until a strong password is set.
	WeakPassword bool `json:"weakPassword,omitempty"`
}

// MinRemoteAdminPasswordLength is the shortest admin password accepted for sign-in from public addresses.
const MinRemoteAdminPasswordLength = 12

// errWeakAdminPasswordRemote is returned to public clients while the admin password is weak.
const errWeakAdminPasswordRemote = "管理员密码过于简单，只能从本机或内网登录。请在服务器 .env 中设置至少 12 位的 CANVAS_ADMIN_PASSWORD 并重启服务。"

// EnsureLocalAdmin creates the admin account on first start and keeps its password,
// role and status in sync with the environment on every later start. When the
// configured username changes, the previous local admin is disabled and signed out.
func (s *Service) EnsureLocalAdmin(creds LocalAdminCredentials) (*model.User, error) {
	user, err := s.ensureLocalAdminAccount(creds)
	if err != nil {
		return nil, err
	}
	if err := s.retirePreviousLocalAdmin(user, IsWeakAdminPassword(creds.Password)); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *Service) retirePreviousLocalAdmin(user *model.User, weakPassword bool) error {
	setting, err := s.repo.SystemSettingOptional(localAdminSettingKey)
	if err != nil {
		return err
	}
	var binding localAdminBinding
	if setting != nil {
		_ = json.Unmarshal([]byte(setting.ValueJSON), &binding)
	}
	if binding.UserID == user.ID && binding.WeakPassword == weakPassword {
		return nil
	}
	if binding.UserID != "" && binding.UserID != user.ID {
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
	encoded, err := json.Marshal(localAdminBinding{UserID: user.ID, WeakPassword: weakPassword})
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

// IsWeakAdminPassword reports whether the password is the default or shorter than MinRemoteAdminPasswordLength.
func IsWeakAdminPassword(value string) bool {
	return IsLocalAdminPassword(value) || utf8.RuneCountInString(value) < MinRemoteAdminPasswordLength
}

// IsLocalNetworkIP reports whether a client address is loopback, private or link-local.
// An empty address (in-process callers) counts as local; an unparsable one does not.
func IsLocalNetworkIP(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	ip := net.ParseIP(value)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

// rejectWeakAdminPasswordRemote blocks sign-in from public addresses while the admin password is weak,
// so a server published on a VPS with the default admin/admin cannot be taken over.
func (s *Service) rejectWeakAdminPasswordRemote(ip string) error {
	if IsLocalNetworkIP(ip) {
		return nil
	}
	setting, err := s.repo.SystemSettingOptional(localAdminSettingKey)
	if err != nil || setting == nil {
		return err
	}
	var binding localAdminBinding
	if json.Unmarshal([]byte(setting.ValueJSON), &binding) == nil && binding.WeakPassword {
		return kernel.Forbidden(errWeakAdminPasswordRemote)
	}
	return nil
}
