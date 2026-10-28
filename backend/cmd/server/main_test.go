package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestEnsureBuiltinWorkbenchCatalogStartupWiring(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:workbench-startup?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	if err := ensureBuiltinWorkbenchCatalog(svc); err != nil {
		t.Fatal(err)
	}
	tools, err := repository.New(db).WorkbenchTools("image", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) == 0 {
		t.Fatal("startup initializer did not publish image workbench tools")
	}
}

func TestAllowedOriginWildcard(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "*")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if !allowedOrigin(context, "https://example.com") {
		t.Fatal("wildcard CORS should allow a valid HTTPS origin")
	}
	if allowedOrigin(context, "ftp://example.com") {
		t.Fatal("wildcard CORS should reject non-HTTP origins")
	}
}

func TestEnvironmentParsers(t *testing.T) {
	t.Setenv("CANVAS_AUTO_MIGRATE", "false")
	value, err := envBool("CANVAS_AUTO_MIGRATE", true)
	if err != nil || value {
		t.Fatalf("envBool = %v, %v", value, err)
	}
	t.Setenv("CANVAS_SHUTDOWN_TIMEOUT", "45s")
	duration, err := envDuration("CANVAS_SHUTDOWN_TIMEOUT", time.Minute)
	if err != nil || duration != 45*time.Second {
		t.Fatalf("envDuration = %v, %v", duration, err)
	}
}

func TestAllowedOriginUsesForwardedHost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	context.Request.Header.Set("X-Forwarded-Host", " canvas.example.com, proxy.internal")
	if !allowedOrigin(context, "https://canvas.example.com") {
		t.Fatal("forwarded public host should be treated as same-origin")
	}
}

func TestParseCORSPolicyNormalizesConfiguredOrigins(t *testing.T) {
	policy, err := parseCORSPolicy(" https://Canvas.example.com/ , http://localhost:3000 ")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := policy.origins["https://canvas.example.com"]; !ok {
		t.Fatal("configured origin was not normalized")
	}
	if _, ok := policy.origins["http://localhost:3000"]; !ok {
		t.Fatal("configured port was not preserved")
	}
}

func TestParseCORSPolicyRejectsNonOriginValue(t *testing.T) {
	if _, err := parseCORSPolicy("https://example.com/app"); err == nil {
		t.Fatal("path-bearing CORS value should be rejected")
	}
	if _, err := parseCORSPolicy("ftp://example.com"); err == nil {
		t.Fatal("non-HTTP CORS value should be rejected")
	}
}

func TestAllowedOriginConfiguredListDoesNotFallbackToArbitraryLocalhost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "https://app.example.com")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if allowedOrigin(context, "http://localhost:3000") {
		t.Fatal("configured CORS list should disable the implicit localhost fallback")
	}
}

func TestRedactCanvasSharePath(t *testing.T) {
	got := redactCanvasSharePath("/api/public/canvas-shares/private-token/resources/resource-1/file")
	if got != "/api/public/canvas-shares/:token/resources/resource-1/file" {
		t.Fatalf("unexpected redacted path: %s", got)
	}
	if got := redactCanvasSharePath("/api/tasks"); got != "/api/tasks" {
		t.Fatalf("unrelated path changed: %s", got)
	}
}

func TestTrustedProxies(t *testing.T) {
	if got, err := trustedProxies(""); err != nil || len(got) != len(defaultTrustedProxies) {
		t.Fatalf("trustedProxies(\"\") = %v, %v", got, err)
	}
	if got, err := trustedProxies("none"); err != nil || got != nil {
		t.Fatalf("trustedProxies(none) = %v, %v", got, err)
	}
	if got, err := trustedProxies("203.0.113.10, 198.51.100.0/24"); err != nil || len(got) != 2 {
		t.Fatalf("trustedProxies(list) = %v, %v", got, err)
	}
	if _, err := trustedProxies("not-an-ip"); err == nil {
		t.Fatal("trustedProxies accepted an invalid address")
	}
}

func TestSpoofedForwardedForIsIgnoredFromPublicClients(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := router.SetTrustedProxies(defaultTrustedProxies); err != nil {
		t.Fatal(err)
	}
	router.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })
	for _, tc := range []struct{ remote, forwarded, want string }{
		{"203.0.113.7:5000", "1.2.3.4", "203.0.113.7"},
		{"172.18.0.2:5000", "9.9.9.9, 203.0.113.7", "203.0.113.7"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/ip", nil)
		req.RemoteAddr = tc.remote
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Body.String() != tc.want {
			t.Errorf("remote %s XFF %q: ClientIP = %s, want %s", tc.remote, tc.forwarded, w.Body.String(), tc.want)
		}
	}
}
