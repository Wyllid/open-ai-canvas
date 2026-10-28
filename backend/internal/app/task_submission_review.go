package app

import (
	"encoding/json"
	"errors"
	"strings"

	"yingce/backend/internal/model"
)

// errTaskSubmissionReview 表示上一次提交在上游的结果不明确，必须先人工查询上游，不能直接重试。
var errTaskSubmissionReview = errors.New("task submission requires review")

// taskSubmissionNeedsReview 判断一次失败是否可能已在上游生成：超时、连接中断这类错误，
// 或者任务已有成功的上游调用记录。读不到调用记录时按需要核对处理。
func (s *Service) taskSubmissionNeedsReview(taskID string, err error) bool {
	if submissionFailureUncertain(err) {
		return true
	}
	succeeded, logErr := s.repo.TaskHasSuccessfulUpstreamCall(taskID)
	return logErr != nil || succeeded
}

func submissionFailureUncertain(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{"524", "timeout", "超时", "deadline exceeded", "context canceled", "connection reset", "unexpected eof", "broken pipe"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

// markTaskSubmissionReview 在任务诊断里记下“上游结果待核对”，重试入口据此拒绝重复提交。
func markTaskSubmissionReview(task *model.Task) {
	if task == nil {
		return
	}
	diagnostic := taskExecutionDiagnostic(task)
	if diagnostic == nil {
		diagnostic = &model.TaskExecutionDiagnostic{Code: "task_terminal", Phase: "execution", SubmissionOutcome: "unknown", DiagnosticID: task.ID}
	}
	diagnostic.SubmissionReview = true
	diagnostic.RetryClass = "reconcile_submission"
	raw, _ := json.Marshal(diagnostic)
	task.ExecutionDiagnosticJSON, task.Diagnostic = string(raw), diagnostic
}

func taskSubmissionUnderReview(task *model.Task) bool {
	diagnostic := taskExecutionDiagnostic(task)
	return diagnostic != nil && diagnostic.SubmissionReview
}

func checkTaskRetryEligibility(task *model.Task) error {
	if taskSubmissionUnderReview(task) {
		return errTaskSubmissionReview
	}
	return nil
}
