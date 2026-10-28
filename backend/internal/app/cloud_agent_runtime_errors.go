// 画布 Agent 面向用户的错误文案净化。
//
// 模型、工具与上游媒体服务的原始错误可能包含密钥、内部地址或冗长堆栈；
// 这里统一转换成可读、可展示的中文说明，原始错误只进诊断日志。

package app

import (
	"errors"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// Only expose known failure categories; raw provider errors can contain URLs and credentials.
func cloudAgentModelFailure(task *model.Task) (string, string) {
	detail, reason := "The model task did not succeed", "model_task_failed"
	if diagnostic := taskExecutionDiagnostic(task); diagnostic != nil && diagnostic.Code == string(ReasonUpstreamDNSFailed) {
		return "The model service domain could not be resolved; check the channel domain and the backend DNS settings. This run has stopped. Check model task " + task.ID, string(ReasonUpstreamDNSFailed)
	}
	raw := strings.ToLower(task.Error)
	switch {
	case strings.Contains(task.Error, "returned no content"):
		// 思考模型的典型失败：整个输出预算被推理吃掉，正文与工具调用皆空。
		detail, reason = "The upstream returned empty content repeatedly (usually reasoning used up the output budget); retrying with reasoning off and a larger budget still failed. Try a non-reasoning model or a smaller context", "model_empty_output"
	case strings.Contains(task.Error, cloudAgentStepTimeoutError):
		detail, reason = "A model step did not return within its time limit (common with long reasoning or a large context); retrying with reasoning off still timed out. An administrator can raise the Agent step timeout", "model_step_timeout"
	case strings.Contains(raw, "connection reset by peer"):
		detail, reason = "The model connection was reset by the peer or a network device in between", "model_connection_reset"
	case strings.Contains(raw, "timeout"), strings.Contains(raw, "deadline exceeded"):
		detail, reason = "The model request timed out", "model_request_timeout"
	case strings.Contains(raw, "connection refused"):
		detail, reason = "Cannot connect to the model service (connection refused)", "model_connection_refused"
	}
	return detail + ". This run has stopped. Check model task " + task.ID, reason
}

func cloudAgentSafeToolError(err error) string {
	if err == nil {
		return ""
	}
	var readLoopErr *cloudAgentReadLoopError
	if errors.As(err, &readLoopErr) {
		return readLoopErr.Error()
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr != nil {
		message := strings.TrimSpace(appErr.Message)
		if cloudAgentSafeUserMessage(message) {
			return message
		}
	}
	return "Tool execution failed; check the input or retry later"
}

func cloudAgentSafeUserMessage(message string) bool {
	if message == "" || !utf8.ValidString(message) || strings.ContainsAny(message, "\x00\r\n") || utf8.RuneCountInString(message) > 600 {
		return false
	}
	lower := strings.ToLower(message)
	for _, marker := range []string{
		// Messages are English now, so the markers name credential and stack-trace shapes rather than
		// common words: "at most" and "tokens" are normal in a user-facing sentence.
		"http://", "https://", "ftp://", "file://", "authorization", "cookie", "secret", "access_token", "token=", "bearer ", "api_key", "apikey", "x-api-key",
		"/var/", "/tmp/", "\\", "stack trace", "traceback", "goroutine ", ".go:", ".js:", ".mjs:", "\tat ", " at /", "sql:", "sqlite", "postgres",
	} {
		if strings.Contains(lower, marker) {
			return false
		}
	}
	return true
}

// cloudAgentSafeMediaTaskError preserves a short, user-facing task diagnostic
// while refusing provider details that commonly contain URLs, credentials, or
// internal request metadata. Task.Error is not a safe presentation field.
func cloudAgentSafeMediaTaskError(task *model.Task) string {
	if task == nil || strings.TrimSpace(task.Error) == "" {
		return "The media task did not succeed"
	}
	// 与画布节点展示同一套分类：网络/审核/存储/HTTP 状态归类，可读的供应商原因原样保留。
	return userFacingTaskError(task.Error)
}
