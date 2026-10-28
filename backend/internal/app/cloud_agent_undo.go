package app

import (
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// UndoCloudAgentCanvas restores only the latest Agent canvas mutation. It is
// deliberately optimistic: the caller must prove that the canvas still has
// the snapshot produced by that mutation. Submitted generation tasks are never
// undone, cancelled, or refunded by this method.
func (s *Service) UndoCloudAgentCanvas(userID, runID, stepID, expectedSnapshotHash, reason string) (map[string]any, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(runID) == "" {
		return nil, Unauthorized("Please sign in first")
	}
	expectedSnapshotHash = strings.TrimSpace(expectedSnapshotHash)
	if len(expectedSnapshotHash) != 64 {
		return nil, BadAuthRequest("A valid canvas snapshot hash is required")
	}
	if _, err := hex.DecodeString(expectedSnapshotHash); err != nil {
		return nil, BadAuthRequest("A valid canvas snapshot hash is required")
	}
	stepID = strings.TrimSpace(stepID)
	if len(stepID) > 160 {
		return nil, BadAuthRequest("The Agent operation ID is too long")
	}
	if len([]rune(reason)) > 2000 {
		return nil, BadAuthRequest("The undo reason is too long")
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("Agent run not found")
		}
		return nil, err
	}
	result := map[string]any{"accepted": false}
	err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		mutation, err := repo.LatestCloudAgentCanvasMutation(userID, runID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return NotFound("This Agent run has no canvas change to undo")
			}
			return err
		}
		if stepID != "" && mutation.StepID != stepID {
			return creationConflict("The Agent operation to undo is no longer this run's latest change")
		}

		canvas, err := repo.CanvasProjectForUser(userID, mutation.CanvasID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return NotFound("The canvas does not exist or you have no access")
			}
			return err
		}
		currentDoc, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return err
		}
		currentHash := cloudAgentCanvasHash(currentDoc)
		if mutation.Status == "undone" {
			if currentHash == mutation.BeforeSnapshotHash && (expectedSnapshotHash == currentHash || expectedSnapshotHash == mutation.AfterSnapshotHash) {
				result = map[string]any{"accepted": true, "snapshotHash": currentHash}
				return nil
			}
			return creationConflict("This Agent change was already undone, but the canvas changed afterwards")
		}
		if mutation.Status == "not_undoable" {
			return BadAuthRequest("This Agent canvas change kept no complete snapshot and cannot be undone")
		}
		if mutation.Status != "applied" {
			return creationConflict("This Agent change cannot be undone now")
		}
		if mutation.HasSubmittedTask {
			return BadAuthRequest("Submitted generation tasks cannot be undone; the task is not cancelled or refunded")
		}
		if expectedSnapshotHash != currentHash || mutation.AfterSnapshotHash != currentHash {
			return creationConflict("The canvas changed afterwards; nothing was undone")
		}
		if mutation.BeforeJSON == "" {
			return BadAuthRequest("This Agent canvas change kept no undo snapshot")
		}
		beforeDoc, err := creationDocument(mutation.BeforeJSON)
		if err != nil {
			return BadAuthRequest("The undo snapshot of this Agent canvas change is invalid")
		}
		if cloudAgentCanvasHash(beforeDoc) != mutation.BeforeSnapshotHash {
			return BadAuthRequest("The undo snapshot of this Agent canvas change failed validation")
		}
		previous := canvas.PayloadJSON
		canvas.PayloadJSON = mutation.BeforeJSON
		if err := saveCreationCanvasWithHistory(repo, canvas, previous); err != nil {
			if errors.Is(err, repository.ErrCreationConflict) {
				return creationConflict("The canvas changed afterwards; nothing was undone")
			}
			return err
		}
		if err := repo.MarkCloudAgentCanvasMutationUndone(userID, runID, mutation.ID, time.Now().UTC()); err != nil {
			if errors.Is(err, repository.ErrCreationConflict) {
				return creationConflict("This Agent change was already handled; read the canvas again")
			}
			return err
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		state.event(runID, "canvas_undone", map[string]any{
			"canvasId":     mutation.CanvasID,
			"stepId":       mutation.StepID,
			"snapshotHash": mutation.BeforeSnapshotHash,
			"reason":       strings.TrimSpace(reason),
		})
		if err := cloudAgentSave(current, &state); err != nil {
			return err
		}
		result = map[string]any{"accepted": true, "snapshotHash": mutation.BeforeSnapshotHash}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
