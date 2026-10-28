package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterAuthRoutes exposes only username/password sign-in for the single local admin.
// Registration, email/SMS verification, password reset and third-party login are not routed.
func RegisterAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerChannelOrderRoutes(r, svc)
	registerAuthProfileRoutes(r, svc)
	r.GET("/auth/settings", func(c *gin.Context) {
		settings, err := svc.PublicAuthSettings()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, settings)
	})
	r.POST("/auth/login", rejectedLoginAudit(svc, "password"), func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "login-ip:"+c.ClientIP(), policy.Request.LoginIPPerTenMinutes, 10*time.Minute) {
			return
		}
		subject, err := svc.LoginRateLimitSubject(req.Username)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "login:"+c.ClientIP()+":"+subject, policy.Request.LoginAccountPerTenMinutes, 10*time.Minute) {
			return
		}
		req.LoginContext = loginRequestContext(c)
		c.Set("login_audit_handled", true)
		result, err := svc.Login(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User})
	})
	r.POST("/auth/logout", func(c *gin.Context) {
		if err := svc.Logout(sessionCookie(c), loginRequestContext(c)); err != nil {
			failService(c, err)
			return
		}
		clearSessionCookie(c)
		ok(c, gin.H{"ok": true})
	})
	r.GET("/auth/session", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			ok(c, gin.H{"user": nil})
			return
		}
		publicUser, err := svc.PublicAuthUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		drawingEngine, err := svc.DrawingEngineSetting()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": publicUser, "runtimeLimits": limits, "drawingEngine": drawingEngine, "features": features})
	})
	r.GET("/channels/system", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		channels, err := svc.PublicSystemChannels()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": channels})
	})
}

func RegisterAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerAdminUserRoutes(r, svc)
	registerAdminChannelRoutes(r, svc)
	registerAdminSettingRoutes(r, svc)
	registerAdminAPILogRoutes(r, svc)
	registerAdminLoginLogRoutes(r, svc)
}

func RegisterSystemProxyRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.Any("/ai/system/:channelId/*path", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.SystemChannel(c.Param("channelId"))
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("系统渠道不存在或已停用"))
			return
		}
		proxySystemRequest(c, svc, user, channel)
	})
}

// SystemProxyNoRouteHandler handles the short public proxy form
// /api/{channelId}/{providerPath}. It deliberately runs from NoRoute so it
// cannot shadow existing business routes such as /api/tasks or /api/plugins.
func SystemProxyNoRouteHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		channelID, providerPath, ok := shortSystemProxyPath(c.Request.URL.Path)
		if !ok {
			fail(c, http.StatusNotFound, errors.New("请求不存在"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.SystemChannel(channelID)
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("系统渠道不存在或已停用"))
			return
		}
		proxySystemRequestPath(c, svc, user, channel, providerPath)
	}
}

func shortSystemProxyPath(rawPath string) (string, string, bool) {
	const prefix = "/api/"
	if !strings.HasPrefix(rawPath, prefix) {
		return "", "", false
	}
	remainder := strings.TrimPrefix(rawPath, prefix)
	separator := strings.IndexByte(remainder, '/')
	if separator <= 0 || separator == len(remainder)-1 {
		return "", "", false
	}
	channelID := remainder[:separator]
	providerPath := remainder[separator:]
	if strings.ContainsAny(channelID, "?#\\") || strings.Contains(providerPath, "\\") || isReservedAPIPathPrefix(channelID) {
		return "", "", false
	}
	return channelID, providerPath, true
}

// NoRoute also sees unmatched descendants of registered API routes. Keep the
// short proxy from interpreting /api/tasks/unknown (or /api/plugins/unknown)
// as a channel request when a business route returns 404.
func isReservedAPIPathPrefix(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "admin", "agent", "ai", "announcements", "banner-announcements", "assets", "auth", "canvas-projects", "channels", "diagnostics", "dramas", "features", "files", "mcp", "model-catalog", "models", "oauth", "plugins", "projects", "public", "resources", "sessions", "settings", "skills", "style-profiles", "tasks", "timeline", "user-data", "voice-profiles", "wallet":
		return true
	default:
		return false
	}
}

func proxySystemRequest(c *gin.Context, svc *service.Service, user *model.User, channel *model.ModelChannel) {
	proxySystemRequestPath(c, svc, user, channel, c.Param("path"))
}

func proxySystemRequestPath(c *gin.Context, svc *service.Service, user *model.User, channel *model.ModelChannel, providerPath string) {
	startedAt := time.Now()
	policy, available := loadRuntimePolicy(c, svc)
	if !available || !enforceRateLimit(c, "system-proxy:"+user.ID, policy.Request.SystemRelayPerMinute, time.Minute) {
		return
	}
	path := providerPath
	if path == "" {
		path = "/"
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, policy.Request.SystemRelayRequestMB<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	modelName := proxyRequestModelForPath(path, c.GetHeader("Content-Type"), body)
	if modelName == "" && c.Request.Method == http.MethodGet && path == "/agnesapi" {
		modelName = strings.TrimSpace(c.Query("model_name"))
	}
	protocol := model.ChannelInterfaceType("")
	capability := "text"
	var channelModel *model.ChannelModel
	if !(c.Request.Method == http.MethodGet && path == "/models") {
		if c.Request.Method == http.MethodGet && systemMiniMaxTaskPath.MatchString(path) && modelName == "" {
			supported, supportErr := svc.SystemChannelHasProtocol(channel.ID, model.ChannelInterfaceMiniMaxVideo)
			if supportErr != nil {
				failService(c, supportErr)
				return
			}
			if !supported {
				fail(c, http.StatusForbidden, errors.New("当前系统渠道未授权 MiniMax 视频协议"))
				return
			}
			protocol = model.ChannelInterfaceMiniMaxVideo
			capability = "video"
		} else {
			var modelErr error
			channelModel, modelErr = svc.SystemChannelModel(channel.ID, modelName)
			if modelErr != nil || channelModel.Protocol == "" {
				fail(c, http.StatusForbidden, errors.New("当前系统渠道未授权该模型或模型协议尚未配置"))
				return
			}
			protocol = channelModel.Protocol
			capability = channelModel.Capability
		}
	}
	if err := authorizeSystemProxy(channel, protocol, c.Request.Method, path, c.GetHeader("Content-Type"), body); err != nil {
		fail(c, http.StatusForbidden, err)
		return
	}
	query := c.Request.URL.Query()
	for _, key := range []string{"key", "api_key", "access_token", "token"} {
		query.Del(key)
	}
	target := service.ChannelAPIURLForProtocol(channel.BaseURL, path, protocol)
	if encodedQuery := query.Encode(); encodedQuery != "" {
		target += "?" + encodedQuery
	}
	validatedTarget, err := svc.ValidateChannelOutboundURL(target)
	if err != nil {
		failService(c, err)
		return
	}
	channelHeaders, err := service.ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		failService(c, err)
		return
	}
	// 同步代理与后台任务必须共享渠道槽位，否则两条入口会共同超过供应商并发上限。
	releaseChannel, concurrencyLimit, err := svc.AcquireChannelSlot(c.Request.Context(), channel.ID, "", 36*time.Minute)
	if err != nil {
		log := apiCallLog(user, channel, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), model.ApiCallStatusFailed, 0, time.Since(startedAt), err.Error(), concurrencyLimit)
		log.ErrorCode, log.Error = service.ChannelSlotFailureDetails(err)
		logSystemProxyCall(svc, log, nil)
		failInternal(c, http.StatusServiceUnavailable, err)
		return
	}
	defer releaseChannel()
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, validatedTarget.String(), bytes.NewReader(body))
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if contentType := c.GetHeader("Content-Type"); contentType != "" {
		upstreamReq.Header.Set("Content-Type", contentType)
	}
	if accept := c.GetHeader("Accept"); accept != "" {
		upstreamReq.Header.Set("Accept", accept)
	}
	service.ApplyOutboundHeaders(upstreamReq, channelHeaders)
	service.ApplyDefaultOutboundHeaders(upstreamReq)
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
		upstreamReq.Header.Set("x-goog-api-key", channel.APIKey)
	} else if protocol == model.ChannelInterfaceClaudeAPI {
		upstreamReq.Header.Set("x-api-key", channel.APIKey)
		upstreamReq.Header.Set("anthropic-version", "2023-06-01")
	} else {
		upstreamReq.Header.Set("Authorization", "Bearer "+channel.APIKey)
	}

	status := model.ApiCallStatusSucceeded
	statusCode := 0
	errorText := ""
	resp, err := svc.OutboundHTTPClientForChannel(35*time.Minute, validatedTarget, channel.ProxyURL).Do(upstreamReq)
	if err != nil {
		status = model.ApiCallStatusFailed
		errorText = err.Error()
		logSystemProxyCall(svc, apiCallLog(user, channel, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), nil)
		fail(c, http.StatusBadGateway, errors.New("系统渠道连接失败"))
		return
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = model.ApiCallStatusFailed
	}
	responseLimit := policy.Request.SystemRelayResponseMB << 20
	streamed := isSystemProxyEventStream(resp)
	var responseBody []byte
	var readErr error
	if streamed {
		responseBody, readErr = streamSystemProxyResponse(c, resp, responseLimit)
	} else {
		responseBody, readErr = io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	}
	if readErr != nil {
		status = model.ApiCallStatusFailed
		errorText = readErr.Error()
		logSystemProxyCall(svc, apiCallLog(user, channel, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
		// SSE 响应头已经发送，流中断后只能关闭连接；非流式响应仍返回结构化错误。
		if !streamed {
			fail(c, http.StatusBadGateway, errors.New("系统渠道响应读取失败"))
		}
		return
	}
	if int64(len(responseBody)) > responseLimit {
		fail(c, http.StatusBadGateway, fmt.Errorf("系统渠道响应超过 %dMB 限制", policy.Request.SystemRelayResponseMB))
		return
	}
	logSystemProxyCall(svc, apiCallLog(user, channel, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
	if streamed {
		return
	}
	copySystemProxyResponseHeaders(c, resp)
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), responseBody)
}

func apiCallLog(user *model.User, channel *model.ModelChannel, capability string, protocol model.ChannelInterfaceType, method string, path string, target string, body []byte, contentType string, status model.ApiCallStatus, statusCode int, duration time.Duration, errorText string, concurrencyLimit int) model.ApiCallLog {
	requestKind := "create"
	apiFormat := "openai"
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
		apiFormat = "gemini"
	}
	if method == http.MethodGet {
		requestKind = "poll"
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") {
			requestKind = "download"
		}
	}
	return model.ApiCallLog{
		UserID:             user.ID,
		ChannelID:          channel.ID,
		Source:             "system-channel",
		Capability:         capability,
		RequestKind:        requestKind,
		Billable:           method == http.MethodPost,
		APIFormat:          apiFormat,
		Method:             method,
		Path:               path,
		Model:              readPayloadModel(body),
		Status:             status,
		StatusCode:         statusCode,
		DurationMs:         duration.Milliseconds(),
		Error:              errorText,
		ConcurrencyLimit:   concurrencyLimit,
		UpstreamURL:        target,
		RequestContentType: contentType,
		RequestBody:        service.SanitizeAPICallPayload(body, contentType),
	}
}

func logSystemProxyCall(svc *service.Service, log model.ApiCallLog, responseBody []byte) error {
	log.ResponseBody = service.SanitizeAPICallPayload(responseBody, "")
	svc.EnrichAPICallLog(&log, responseBody)
	return svc.LogAPICall(log)
}

func readPayloadModel(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	if modelName, ok := payload["model"].(string); ok {
		return modelName
	}
	return ""
}

func currentUser(c *gin.Context, svc *service.Service) (*model.User, error) {
	return svc.CurrentUser(sessionCookie(c))
}

func sessionCookie(c *gin.Context) string {
	value, _ := c.Cookie(service.SessionCookieName)
	return value
}

func passwordResetRateLimitSubject(value string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(value))))
	return fmt.Sprintf("%x", sum[:])
}

func setSessionCookie(c *gin.Context, value string, maxAge int) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     service.SessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionCookie(c *gin.Context) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     service.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}
