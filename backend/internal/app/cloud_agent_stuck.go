package app

import (
	"errors"
	"fmt"
	"log"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentStuckAfter = 5 * time.Minute
const cloudAgentConflictLogThreshold = 15

func (s *Service) terminateStuckCloudAgent(run *model.CloudAgentExecution) bool {
	if run == nil || run.CleanupPending || (run.Status != "running" && run.Status != "queued") {
		return false
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false
	}
	if s.cloudAgentHasLiveWork(run, &state) {
		return false
	}
	last := cloudAgentLastEventAt(&state)
	if last.IsZero() || time.Since(last) < cloudAgentStuckAfter {
		return false
	}
	idle := time.Since(last)
	if err := s.terminateCloudAgent(run, fmt.Sprintf("The run made no progress for %.0f minutes (no new events and no running tasks), so it was judged stuck and stopped; you can start it again", idle.Minutes())); err != nil {
		if !errors.Is(err, repository.ErrCreationConflict) {
			log.Printf("agent stuck cleanup %s: %v", run.ID, err)
		}
		return false
	}
	log.Printf("agent scheduler: run=%s judged stuck and closed (last event %.0f minutes ago)", run.ID, idle.Minutes())
	return true
}

func (s *Service) cloudAgentHasLiveWork(run *model.CloudAgentExecution, state *cloudAgentRuntime) bool {
	for _, taskID := range []string{state.ActiveTaskID, state.MediaTaskID, state.StoryboardTaskID} {
		if taskID == "" {
			continue
		}
		task, err := s.repo.TaskForUser(run.UserID, taskID)
		if err != nil {
			return true
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return true
		}
	}
	return false
}

func cloudAgentLastEventAt(state *cloudAgentRuntime) time.Time {
	if state == nil || len(state.Events) == 0 {
		return time.Time{}
	}
	return state.Events[len(state.Events)-1].CreatedAt
}

func (s *Service) noteCloudAgentSchedulerConflict(runID string) {
	if s.agentConflictStreak == nil {
		s.agentConflictStreak = map[string]int{}
	}
	s.agentConflictStreak[runID]++
	if streak := s.agentConflictStreak[runID]; streak == cloudAgentConflictLogThreshold {
		log.Printf("agent scheduler: run=%s hit %d CAS conflicts in a row (another writer keeps holding the row); the run is probably stuck", runID, streak)
	}
}

func (s *Service) clearCloudAgentSchedulerConflict(runID string) {
	if s.agentConflictStreak == nil {
		return
	}
	delete(s.agentConflictStreak, runID)
}
