package auth

import (
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

func TestEnsureLocalAdminRetiresTheOldAccountAfterARename(t *testing.T) {
	svc, repo := newLocalAdminTestService(t)
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
	if renamed.ID == old.ID {
		t.Fatal("a new username is a new account")
	}
	if _, err := svc.Login(LoginRequest{Username: "admin", Password: "admin"}); err == nil {
		t.Fatal("the old default admin still signs in after the rename")
	}
	if _, err := svc.CurrentUser(session.Session); err == nil {
		t.Fatal("the old admin's session is still valid after the rename")
	}
	stored, err := repo.User(old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Role == model.UserRoleAdmin || stored.Status != model.UserStatusDisabled {
		t.Fatalf("old admin = %#v", stored)
	}
	if _, err := svc.Login(LoginRequest{Username: "owner", Password: "a-long-new-secret"}); err != nil {
		t.Fatal(err)
	}
	// Restarting with the same settings leaves the new admin alone.
	if _, err := svc.EnsureLocalAdmin(LocalAdminCredentials{Username: "owner", Password: "a-long-new-secret"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Login(LoginRequest{Username: "owner", Password: "a-long-new-secret"}); err != nil {
		t.Fatal(err)
	}
}
