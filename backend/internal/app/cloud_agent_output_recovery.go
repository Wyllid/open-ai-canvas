package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func cloudAgentOutputViolation(text string, callCount int) string {
	if len(text) > cloudAgentMaxOutputBytes {
		return fmt.Sprintf("The text is %d bytes, over the %d byte limit per step", len(text), cloudAgentMaxOutputBytes)
	}
	if callCount > cloudAgentMaxToolCalls {
		return fmt.Sprintf("%d tool calls were issued at once, over the limit of %d per step", callCount, cloudAgentMaxToolCalls)
	}
	return ""
}

func (s *Service) correctCloudAgentOutput(run *model.CloudAgentExecution, state *cloudAgentRuntime, violation string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentRuntimeMessage(cloudAgentRuntimeContext{
			Kind: cloudAgentContextInvalidOutput, Detail: violation,
			MaxOutputBytes: cloudAgentMaxOutputBytes, MaxToolCalls: cloudAgentMaxToolCalls,
		}))
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}

func cloudAgentTruncatedToolArguments(task *model.Task) bool {
	if task == nil {
		return false
	}
	return strings.Contains(task.Error, "not complete JSON")
}

func (s *Service) correctCloudAgentTruncatedCalls(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentRuntimeMessage(cloudAgentRuntimeContext{Kind: cloudAgentContextTruncatedArguments}))
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}
