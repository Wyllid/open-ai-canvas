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

// localAdminSettingKey remembers which account is the local admin and which .env
// credentials were last applied to it.
const localAdminSettingKey = "local_admin"

type localAdminBinding struct {
	UserID string `json:"userId"`
	// WeakPassword limits sign-in to loopback and private networks until a strong password is set.
	WeakPassword bool `json:"weakPassword,omitempty"`
	// EnvHash is a bcrypt hash of the .env username and password last applied. While the .env
	// keeps those values, the username and password changed in the settings stay in effect.
	EnvHash string `json:"envHash,omitempty"`
}

// MinRemoteAdminPasswordLength is the shortest admin password accepted for sign-in from public addresses.
const MinRemoteAdminPasswordLength = 12

// errWeakAdminPasswordRemote is returned to public clients while the admin password is weak.
const errWeakAdminPasswordRemote = "管理员密码过于简单，只能从本机或内网登录。请从本机登录后在“账号”中设置至少 12 位的密码，或修改服务器 .env 中的 CANVAS_ADMIN_PASSWORD 并重启服务。"

// EnsureLocalAdmin runs on every start. The .env credentials create the admin on the first
// start and are applied again whenever they change, which is also how a forgotten password is
// recovered. While they stay the same, the username and password changed in the settings win.
// Applying new .env credentials renames the bound admin in place, so projects and assets keep
// their owner; only when the new username already belongs to another account is that account
// promoted and the previous admin disabled.
func (s *Service) EnsureLocalAdmin(creds LocalAdminCredentials) (*model.User, error) {
	username := NormalizeUsername(creds.Username)
	if username == "" {
		return nil, errors.New("local admin username is empty")
	}
	if creds.Password == "" {
		return nil, errors.New("local admin password is empty")
	}
	binding, setting, err := s.localAdminBinding()
	if err != nil {
		return nil, err
	}
	if binding.UserID != "" && binding.EnvHash != "" && verifyPassword(localAdminEnvSecret(username, creds.Password), binding.EnvHash) {
		user, err := s.repo.User(binding.UserID)
		switch {
		case err == nil && user.Role == model.UserRoleAdmin && user.Status == model.UserStatusActive:
			return user, nil
		case err == nil:
			user.Role, user.Status, user.UpdatedAt = model.UserRoleAdmin, model.UserStatusActive, time.Now()
			if err := s.repo.SyncLocalAdmin(user, false); err != nil {
				return nil, err
			}
			return user, nil
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return nil, err
		}
	}
	user, err := s.applyLocalAdminEnv(username, creds.Password, binding.UserID)
	if err != nil {
		return nil, err
	}
	if binding.UserID != "" && binding.UserID != user.ID {
		if err := s.retireLocalAdmin(binding.UserID); err != nil {
			return nil, err
		}
	}
	envHash, err := HashPassword(localAdminEnvSecret(username, creds.Password))
	if err != nil {
		return nil, err
	}
	return user, s.saveLocalAdminBinding(setting, localAdminBinding{UserID: user.ID, WeakPassword: IsWeakAdminPassword(creds.Password), EnvHash: envHash}, user.ID)
}

// localAdminEnvSecret pre-hashes the pair so bcrypt's 72-byte limit cannot hide a password change.
func localAdminEnvSecret(username string, password string) string {
	return HashToken(strings.ToLower(username) + "\x00" + password)
}

func (s *Service) localAdminBinding() (localAdminBinding, *model.SystemSetting, error) {
	var binding localAdminBinding
	setting, err := s.repo.SystemSettingOptional(localAdminSettingKey)
	if err != nil {
		return binding, nil, err
	}
	if setting != nil {
		_ = json.Unmarshal([]byte(setting.ValueJSON), &binding)
	}
	return binding, setting, nil
}

func (s *Service) saveLocalAdminBinding(previous *model.SystemSetting, binding localAdminBinding, updatedBy string) error {
	encoded, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	now := time.Now()
	next := &model.SystemSetting{Key: localAdminSettingKey, ValueJSON: string(encoded), UpdatedBy: updatedBy, CreatedAt: now, UpdatedAt: now}
	if previous != nil {
		next.CreatedAt = previous.CreatedAt
	}
	return s.repo.SaveSystemSetting(next)
}

func (s *Service) retireLocalAdmin(userID string) error {
	previous, err := s.repo.User(userID)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil
	case err != nil:
		return err
	case previous.Role == model.UserRoleAdmin || previous.Status == model.UserStatusActive:
		previous.Role, previous.Status, previous.UpdatedAt = model.UserRoleUser, model.UserStatusDisabled, time.Now()
		return s.repo.SyncLocalAdmin(previous, true)
	}
	return nil
}

// applyLocalAdminEnv makes the .env credentials valid: an existing account with that username is
// promoted, otherwise the bound admin is renamed, otherwise a new admin is created.
func (s *Service) applyLocalAdminEnv(username string, password string, boundUserID string) (*model.User, error) {
	now := time.Now()
	user, err := s.repo.UserByUsername(username)
	if errors.Is(err, gorm.ErrRecordNotFound) && boundUserID != "" {
		user, err = s.repo.User(boundUserID)
		if err == nil {
			if user.DisplayName == user.Username {
				user.DisplayName = username
			}
			user.Username = username
		}
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		hash, err := HashPassword(password)
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
	passwordChanged := !verifyPassword(password, user.PasswordHash)
	if passwordChanged {
		hash, err := HashPassword(password)
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
