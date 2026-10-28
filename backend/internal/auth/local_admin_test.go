package auth

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newLocalAdminTestService(t *testing.T) (*Service, *repository.Repository) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.LoginLog{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	return New(repo, nil, nil), repo
}

func TestEnsureLocalAdminCreatesAdminThatCanLogIn(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	user, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive {
		t.Fatalf("EnsureLocalAdmin() = %#v", user)
	}
	result, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CurrentUser(result.Session); err != nil {
		t.Fatalf("session from login is not accepted: %v", err)
	}
}

func TestEnsureLocalAdminRotatesPasswordAndRevokesSessions(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "new-secret"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CurrentUser(result.Session); err == nil {
		t.Fatal("old session still valid after password change")
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"}); err == nil {
		t.Fatal("old password still accepted")
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "new-secret"}); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureLocalAdminKeepsSessionsWhenPasswordUnchanged(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CurrentUser(result.Session); err != nil {
		t.Fatalf("restart with same password dropped the session: %v", err)
	}
}

func TestEnsureLocalAdminPromotesExistingUser(t *testing.T) {
	svc, repo := newLocalAdminTestService(t)
	hash, _ := HashPassword("admin")
	existing := model.User{ID: "u1", Username: "admin", Role: model.UserRoleUser, Status: model.UserStatusDisabled, PasswordHash: hash}
	if err := repo.CreateRegisteredUser(&existing); err != nil {
		t.Fatal(err)
	}
	user, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := repo.User(user.ID)
	if stored.Role != model.UserRoleAdmin || stored.Status != model.UserStatusActive {
		t.Fatalf("stored user = %#v", stored)
	}
}

func TestEnsureLocalAdminRenamesTheBoundAdminInPlace(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	old, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "owner", Password: "a-long-new-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if renamed.ID != old.ID {
		t.Fatal("renaming the .env admin must keep the account, so projects keep their owner")
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"}); err == nil {
		t.Fatal("the old username still signs in after the rename")
	}
	if _, err := svc.CurrentUser(session.Session); err == nil {
		t.Fatal("the session from the old password is still valid")
	}
	if _, err := svc.Login(LoginRequest{Username: "owner", Password: "a-long-new-secret"}); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureLocalAdminRetiresTheBoundAdminWhenTheNewUsernameIsAnotherAccount(t *testing.T) {
	svc, repo := newLocalAdminTestService(t)
	old, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := HashPassword("whatever")
	other := model.User{ID: "u2", Username: "owner", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: hash}
	if err := repo.CreateRegisteredUser(&other); err != nil {
		t.Fatal(err)
	}
	promoted, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "owner", Password: "a-long-new-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if promoted.ID != other.ID {
		t.Fatalf("promoted %s, want the existing owner account", promoted.ID)
	}
	stored, err := repo.User(old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Role == model.UserRoleAdmin || stored.Status != model.UserStatusDisabled {
		t.Fatalf("old admin = %#v", stored)
	}
}

func TestAccountChangedInSettingsSurvivesRestartUntilTheEnvChanges(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	env := LocalAdminCredentials{Username: "admin", Password: "admin"}
	admin, err := svc.EnsureLocalAdmin(env)
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ChangeLocalAccount(admin, session.Session, LocalAccountRequest{CurrentPassword: "wrong", Username: "studio", NewPassword: "a-long-ui-password"}); err == nil {
		t.Fatal("account change accepted a wrong current password")
	}
	if err := svc.ChangeLocalAccount(admin, session.Session, LocalAccountRequest{CurrentPassword: "admin", Username: "studio", NewPassword: "short"}); err == nil {
		t.Fatal("account change accepted a weak password")
	}
	if err := svc.ChangeLocalAccount(admin, session.Session, LocalAccountRequest{CurrentPassword: "admin", Username: "studio", NewPassword: "a-long-ui-password"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CurrentUser(session.Session); err == nil {
		t.Fatal("sessions survive an account change")
	}
	// The new password is strong, so public addresses may sign in.
	if _, err := svc.Login(LoginRequest{Username: "studio", Password: "a-long-ui-password", LoginContext: LoginContext{IP: "203.0.113.7"}}); err != nil {
		t.Fatalf("public login after a strong password: %v", err)
	}

	// Restart with the same .env: the settings win.
	if _, err := svc.EnsureLocalAdmin(env); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(LoginRequest{Username: "studio", Password: "a-long-ui-password"}); err != nil {
		t.Fatalf("restart reverted the account changed in the settings: %v", err)
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"}); err == nil {
		t.Fatal("restart brought the .env credentials back without a change in the .env")
	}

	// Changing the .env recovers access and keeps the same account.
	recovered, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "a-recovery-password"})
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ID != admin.ID {
		t.Fatal("recovery through the .env created a new account")
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "a-recovery-password"}); err != nil {
		t.Fatalf("recovery credentials rejected: %v", err)
	}
}

func TestWeakAdminPasswordOnlySignsInFromLocalNetworks(t *testing.T) {
	svc, _ := newLocalAdminTestService(t)
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: "admin"}); err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"127.0.0.1", "::1", "192.168.1.20", "10.0.0.5", "172.18.0.3"} {
		if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin", LoginContext: LoginContext{IP: ip}}); err != nil {
			t.Fatalf("login from %s with weak password: %v", ip, err)
		}
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin", LoginContext: LoginContext{IP: "203.0.113.7"}}); err == nil || !strings.Contains(err.Error(), "CANVAS_ADMIN_PASSWORD") {
		t.Fatalf("public login with weak password error = %v", err)
	}

	strong := "a-long-admin-secret"
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "admin", Password: strong}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: strong, LoginContext: LoginContext{IP: "203.0.113.7"}}); err != nil {
		t.Fatalf("public login with strong password: %v", err)
	}
}

func TestIsWeakAdminPassword(t *testing.T) {
	for value, want := range map[string]bool{"admin": true, "short-pass1": true, "twelve-chars": false, "a-long-admin-secret": false} {
		if got := IsWeakAdminPassword(value); got != want {
			t.Errorf("IsWeakAdminPassword(%q) = %v, want %v", value, got, want)
		}
	}
}
