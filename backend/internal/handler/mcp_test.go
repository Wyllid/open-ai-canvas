package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const testMCPToken = "test-token-0123456789abcdef0123456789abcdef"

func newMCPTestRouter(t *testing.T, token string) *gin.Engine {
	t.Helper()
	t.Setenv("CANVAS_MCP_TOKEN", token)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterMCPRoutes(router.Group("/api"), &service.Service{})
	return router
}

func postMCP(router *gin.Engine, body string, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestMCPRoutesStayOffWithoutAStrongToken(t *testing.T) {
	for _, token := range []string{"", "too-short"} {
		router := newMCPTestRouter(t, token)
		if recorder := postMCP(router, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, map[string]string{"Authorization": "Bearer " + token}); recorder.Code != http.StatusNotFound {
			t.Fatalf("token %q: status=%d, want 404", token, recorder.Code)
		}
	}
}

func TestMCPRejectsBrowserOriginsAndBadTokens(t *testing.T) {
	router := newMCPTestRouter(t, testMCPToken)
	ping := `{"jsonrpc":"2.0","id":1,"method":"ping"}`
	cases := []struct {
		name    string
		headers map[string]string
		want    int
	}{
		{"origin", map[string]string{"Authorization": "Bearer " + testMCPToken, "Origin": "http://localhost:5173"}, http.StatusForbidden},
		{"missing token", nil, http.StatusUnauthorized},
		{"wrong token", map[string]string{"Authorization": "Bearer " + testMCPToken + "x"}, http.StatusUnauthorized},
		{"basic auth", map[string]string{"Authorization": "Basic " + testMCPToken}, http.StatusUnauthorized},
		{"bad protocol", map[string]string{"Authorization": "Bearer " + testMCPToken, "MCP-Protocol-Version": "1999-01-01"}, http.StatusBadRequest},
	}
	for _, item := range cases {
		if recorder := postMCP(router, ping, item.headers); recorder.Code != item.want {
			t.Errorf("%s: status=%d, want %d", item.name, recorder.Code, item.want)
		}
	}
}

func TestMCPTransportEdges(t *testing.T) {
	router := newMCPTestRouter(t, testMCPToken)
	auth := map[string]string{"Authorization": "Bearer " + testMCPToken}
	if recorder := postMCP(router, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, auth); recorder.Code != http.StatusAccepted || recorder.Body.Len() != 0 {
		t.Fatalf("notification status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	for body, code := range map[string]int{`{not json`: jsonRPCParseError, `[{"jsonrpc":"2.0","id":1,"method":"ping"}]`: jsonRPCInvalidReq, `{"id":1,"method":"ping"}`: jsonRPCInvalidReq} {
		recorder := postMCP(router, body, auth)
		var response mcpResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Error == nil || response.Error.Code != code {
			t.Errorf("body %s: got %s, want error %d", body, recorder.Body.String(), code)
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/mcp", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status=%d, want 405", recorder.Code)
	}
}

func TestDispatchMCPInitializeAndTools(t *testing.T) {
	svc := &service.Service{}
	initialize := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("1"), Method: "initialize", Params: json.RawMessage(`{"protocolVersion":"2025-03-26"}`)})
	raw, _ := json.Marshal(initialize)
	if !strings.Contains(string(raw), `"protocolVersion":"2025-03-26"`) || !strings.Contains(string(raw), `"tools"`) {
		t.Fatalf("initialize = %s", raw)
	}
	unknown := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("1"), Method: "initialize", Params: json.RawMessage(`{"protocolVersion":"1999-01-01"}`)})
	raw, _ = json.Marshal(unknown)
	if !strings.Contains(string(raw), `"protocolVersion":"`+mcpLatestProtocol+`"`) {
		t.Fatalf("initialize fallback = %s", raw)
	}

	list := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("2"), Method: "tools/list"})
	raw, _ = json.Marshal(list)
	for _, name := range []string{"canvas_list", "canvas_get_state", "canvas_apply_ops", "drama_episode_get", "skill_search"} {
		if !strings.Contains(string(raw), `"name":"`+name+`"`) {
			t.Errorf("tools/list is missing %s", name)
		}
	}
	for _, name := range []string{"generate_media", "request_approval", "remember_lesson", "ask_user"} {
		if strings.Contains(string(raw), `"name":"`+name) {
			t.Errorf("tools/list must not expose %s", name)
		}
	}

	call := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("3"), Method: "tools/call", Params: json.RawMessage(`{"name":"nope","arguments":{}}`)})
	if call.Error == nil || call.Error.Code != jsonRPCInvalidParam {
		t.Fatalf("unknown tool = %+v", call)
	}
	missing := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("4"), Method: "tools/call", Params: json.RawMessage(`{"name":"canvas_get_state","arguments":{}}`)})
	raw, _ = json.Marshal(missing)
	if missing.Error != nil || !strings.Contains(string(raw), `"isError":true`) || !strings.Contains(string(raw), "canvasId is required") {
		t.Fatalf("missing canvasId = %s", raw)
	}
	if method := dispatchMCP(svc, "user", mcpRequest{JSONRPC: "2.0", ID: json.RawMessage("5"), Method: "resources/list"}); method.Error == nil || method.Error.Code != jsonRPCNoMethod {
		t.Fatalf("unknown method = %+v", method)
	}
}

func TestMCPRateLimiterWindow(t *testing.T) {
	limiter := newMCPRateLimiter(2, time.Minute)
	now := time.Now()
	if !limiter.allow(now) || !limiter.allow(now) || limiter.allow(now) {
		t.Fatal("limiter should allow exactly two calls in a window")
	}
	if !limiter.allow(now.Add(time.Minute)) {
		t.Fatal("limiter should reset after the window")
	}
}

func TestMCPToolContentAddsImages(t *testing.T) {
	content, err := mcpToolContent(&service.MCPToolResult{Value: map[string]int{"version": 2}, Images: []service.MCPImage{{MimeType: "image/jpeg", Data: []byte{1, 2}}}})
	if err != nil || len(content) != 2 || content[0]["text"] != `{"version":2}` || content[1]["type"] != "image" || content[1]["data"] != "AQI=" {
		t.Fatalf("content = %+v, %v", content, err)
	}
	if plain, err := mcpToolContent([]string{"a"}); err != nil || len(plain) != 1 || plain[0]["text"] != `["a"]` {
		t.Fatalf("plain = %+v, %v", plain, err)
	}
}
