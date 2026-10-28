package app

import (
	"errors"
	"fmt"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// SDK 的参数校验发生在 /tool 之前；回填真实失败，保持调用游标与运行时一致。
func (s *Service) handlePiToolValidationFailure(userID, runID string, data map[string]any) (any, error) {
	callID, toolName := stringField(data, "callId"), stringField(data, "toolName")
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if _, recorded := cloudAgentToolMessage(&state, callID); recorded {
				return nil
			}
			if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
				return fmt.Errorf("Tool call %q has no matching model tool call", callID)
			}
			call := state.Calls[state.CallIndex]
			if call.ID != callID || call.Function.Name != toolName {
				return fmt.Errorf("Tool call %q does not match the tool call declared by the model", callID)
			}
			result := map[string]any{
				"phase": "validation", "taskSubmitted": false,
				"validationError": stringField(data, "error"),
			}
			argumentErr := &cloudAgentArgumentError{BadAuthRequest("The tool arguments do not match the declaration and the call was not executed; fix them according to the returned parameters")}
			cloudAgentRecordToolResult(current, &state, call, result, argumentErr)
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return map[string]any{"ok": err == nil}, err
		}
	}
	return nil, repository.ErrCreationConflict
}
