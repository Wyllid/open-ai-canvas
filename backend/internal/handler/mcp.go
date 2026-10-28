package handler

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// The MCP endpoint lets a local agent (Codex, Claude Code) read and edit canvases
// and dramas as the local admin. It speaks the streamable HTTP transport with plain
// JSON responses only: no SSE stream and no session id.
const (
	mcpMinTokenLength   = 32
	mcpMaxBodyBytes     = 4 << 20
	mcpRequestsPerMin   = 240
	mcpServerName       = "open-ai-canvas"
	mcpServerVersion    = "1.0.0"
	mcpLatestProtocol   = "2025-06-18"
	jsonRPCParseError   = -32700
	jsonRPCInvalidReq   = -32600
	jsonRPCNoMethod     = -32601
	jsonRPCInvalidParam = -32602
	jsonRPCInternal     = -32603
)

var mcpSupportedProtocols = map[string]bool{"2025-03-26": true, "2025-06-18": true, "2025-11-25": true}

type mcpConfig struct {
	tokenHash     [32]byte
	adminUsername string
	limiter       *mcpRateLimiter
}

type mcpRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// RegisterMCPRoutes mounts /api/mcp only when CANVAS_MCP_TOKEN is set. Without it
// the path stays unregistered and answers 404 like any other unknown route.
func RegisterMCPRoutes(api *gin.RouterGroup, svc *service.Service) {
	token := strings.TrimSpace(os.Getenv("CANVAS_MCP_TOKEN"))
	if token == "" {
		return
	}
	if len(token) < mcpMinTokenLength {
		log.Printf("MCP endpoint disabled: CANVAS_MCP_TOKEN must be at least %d characters", mcpMinTokenLength)
		return
	}
	username := strings.TrimSpace(os.Getenv("CANVAS_ADMIN_USERNAME"))
	if username == "" {
		username = "admin"
	}
	config := &mcpConfig{tokenHash: sha256.Sum256([]byte(token)), adminUsername: username, limiter: newMCPRateLimiter(mcpRequestsPerMin, time.Minute)}
	api.POST("/mcp", func(c *gin.Context) { handleMCP(c, svc, config) })
	api.GET("/mcp", func(c *gin.Context) {
		c.Header("Allow", http.MethodPost)
		c.Status(http.StatusMethodNotAllowed)
	})
	api.DELETE("/mcp", func(c *gin.Context) {
		c.Header("Allow", http.MethodPost)
		c.Status(http.StatusMethodNotAllowed)
	})
}

func handleMCP(c *gin.Context, svc *service.Service, config *mcpConfig) {
	// A browser always sends Origin. The endpoint is for local CLI agents only, so
	// refusing every Origin blocks DNS rebinding and cross-site calls outright.
	if c.GetHeader("Origin") != "" {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	if !config.authorized(c.GetHeader("Authorization")) {
		c.Header("WWW-Authenticate", `Bearer realm="mcp"`)
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if !config.limiter.allow(time.Now()) {
		c.Header("Retry-After", "60")
		c.AbortWithStatus(http.StatusTooManyRequests)
		return
	}
	if version := c.GetHeader("MCP-Protocol-Version"); version != "" && !mcpSupportedProtocols[version] {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, mcpMaxBodyBytes))
	if err != nil {
		c.AbortWithStatus(http.StatusRequestEntityTooLarge)
		return
	}
	body = bytes.TrimSpace(body)
	if len(body) > 0 && body[0] == '[' {
		// Batching was dropped from MCP in 2025-06-18; keep one message per request.
		c.JSON(http.StatusOK, mcpErrorResponse(nil, jsonRPCInvalidReq, "batch requests are not supported"))
		return
	}
	var request mcpRequest
	if err := json.Unmarshal(body, &request); err != nil {
		c.JSON(http.StatusOK, mcpErrorResponse(nil, jsonRPCParseError, "invalid JSON"))
		return
	}
	if request.JSONRPC != "2.0" || request.Method == "" {
		c.JSON(http.StatusOK, mcpErrorResponse(request.ID, jsonRPCInvalidReq, "invalid JSON-RPC request"))
		return
	}
	if len(request.ID) == 0 {
		// Notifications (notifications/initialized and friends) get no body.
		c.Status(http.StatusAccepted)
		return
	}
	user, err := svc.MCPUser(config.adminUsername)
	if err != nil {
		c.JSON(http.StatusOK, mcpErrorResponse(request.ID, jsonRPCInternal, err.Error()))
		return
	}
	c.JSON(http.StatusOK, dispatchMCP(svc, user.ID, request))
}

func dispatchMCP(svc *service.Service, userID string, request mcpRequest) mcpResponse {
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		version := params.ProtocolVersion
		if !mcpSupportedProtocols[version] {
			version = mcpLatestProtocol
		}
		return mcpResult(request.ID, gin.H{
			"protocolVersion": version,
			"capabilities":    gin.H{"tools": gin.H{"listChanged": false}},
			"serverInfo":      gin.H{"name": mcpServerName, "version": mcpServerVersion},
			"instructions":    "Call canvas_list first and pass its id as canvasId. Tools prepare nodes, prompts, storyboards and tables; media generation is started by the person in the canvas.",
		})
	case "ping":
		return mcpResult(request.ID, gin.H{})
	case "tools/list":
		tools, err := svc.MCPTools()
		if err != nil {
			log.Printf("MCP tools/list failed: error_type=%T", err)
			return mcpErrorResponse(request.ID, jsonRPCInternal, "tool list unavailable")
		}
		return mcpResult(request.ID, gin.H{"tools": tools})
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil || strings.TrimSpace(params.Name) == "" {
			return mcpErrorResponse(request.ID, jsonRPCInvalidParam, "tools/call needs a tool name")
		}
		result, err := svc.CallMCPTool(userID, params.Name, params.Arguments)
		if errors.Is(err, service.ErrMCPToolNotFound) {
			return mcpErrorResponse(request.ID, jsonRPCInvalidParam, "unknown tool: "+params.Name)
		}
		if err != nil {
			return mcpResult(request.ID, mcpToolError(params.Name, err))
		}
		text, err := json.Marshal(result)
		if err != nil {
			return mcpResult(request.ID, mcpToolError(params.Name, err))
		}
		return mcpResult(request.ID, gin.H{"content": []gin.H{{"type": "text", "text": string(text)}}, "isError": false})
	default:
		return mcpErrorResponse(request.ID, jsonRPCNoMethod, "method not found: "+request.Method)
	}
}

// mcpToolError reports a failed call to the agent so it can correct itself. Only
// messages the service marked as safe to show are passed through.
func mcpToolError(name string, err error) gin.H {
	message := "tool failed"
	var appErr *service.AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		message = appErr.Message
	} else {
		log.Printf("MCP tool failed: tool=%s error_type=%T", name, err)
	}
	return gin.H{"content": []gin.H{{"type": "text", "text": message}}, "isError": true}
}

func mcpResult(id json.RawMessage, result any) mcpResponse {
	return mcpResponse{JSONRPC: "2.0", ID: id, Result: result}
}

func mcpErrorResponse(id json.RawMessage, code int, message string) mcpResponse {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	return mcpResponse{JSONRPC: "2.0", ID: id, Error: &mcpError{Code: code, Message: message}}
}

func (config *mcpConfig) authorized(header string) bool {
	token, found := strings.CutPrefix(strings.TrimSpace(header), "Bearer ")
	if !found {
		return false
	}
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return subtle.ConstantTimeCompare(hash[:], config.tokenHash[:]) == 1
}

// mcpRateLimiter is a fixed-window counter. One local agent is the only expected
// client, so a single shared window is enough.
type mcpRateLimiter struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	windowStart time.Time
	count       int
}

func newMCPRateLimiter(limit int, window time.Duration) *mcpRateLimiter {
	return &mcpRateLimiter{limit: limit, window: window}
}

func (l *mcpRateLimiter) allow(now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.windowStart) >= l.window {
		l.windowStart = now
		l.count = 0
	}
	if l.count >= l.limit {
		return false
	}
	l.count++
	return true
}
