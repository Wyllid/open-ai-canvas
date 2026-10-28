package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

type queuedChannelExecutionProbe struct {
	*Service
	calls int
}

func (p *queuedChannelExecutionProbe) processTask(context.Context, model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	p.calls++
	return nil, nil, errors.New("execution probe reached")
}

func TestQueuedCustomChannelRecheck(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		retry, enabled, system bool
		dispatch               string
	}{
		{name: "new"}, {name: "retry", retry: true},
		{name: "enabled", enabled: true}, {name: "system", system: true},
		{name: "accepted", dispatch: "accepted"},
		{name: "submission_unknown", dispatch: "submission_unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			actor := &model.User{ID: "admin", Role: "admin"}
			features := FeatureAvailability{CustomChannelsEnabled: true, TaskCenterEnabled: true}
			if _, err := s.UpdateFeatureAvailability(actor, features); err != nil {
				t.Fatal(err)
			}
			input := map[string]any{"mode": "text", "config": map[string]any{"baseUrl": "https://provider.example", "apiKey": "test-key", "model": "test"}}
			if tc.system {
				input["config"].(map[string]any)["channelId"] = "system-channel"
			}
			if err := s.requireCustomChannelsForTaskInput(input); err != nil {
				t.Fatal(err)
			}
			if err := s.protectTaskSecrets(input); err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(input)
			task := &model.Task{ID: newID(), UserID: "user", Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: string(encoded), RouteRun: 1}
			if tc.retry {
				task.Status = model.TaskStatusFailed
				task.Attempts = 1
			}
			if err := db.Create(task).Error; err != nil {
				t.Fatal(err)
			}
			if tc.retry {
				var err error
				task, err = s.repo.RetryTask(task.UserID, task, 10)
				if err != nil {
					t.Fatal(err)
				}
			}
			if tc.dispatch != "" {
				attempt := &model.RouteAttempt{ID: newID(), TaskID: task.ID, RouteRun: task.RouteRun, DispatchState: tc.dispatch, Status: "selected", AttemptNumber: 1}
				if err := db.Create(attempt).Error; err != nil {
					t.Fatal(err)
				}
			}
			features.CustomChannelsEnabled = tc.enabled
			if _, err := s.UpdateFeatureAvailability(actor, features); err != nil {
				t.Fatal(err)
			}
			claimed, err := s.repo.ClaimNextTask("worker", time.Minute)
			if err != nil || claimed == nil {
				t.Fatalf("claim: %v %v", claimed, err)
			}
			probe := &queuedChannelExecutionProbe{Service: s}
			s.taskRouteExecutor = &taskRouteExecutor{port: probe}
			err = s.taskWorker().processClaimedTask(claimed, nil)
			stored, readErr := s.repo.Task(task.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			wantCalls, wantError := 0, "自定义渠道"
			if tc.enabled || tc.system {
				wantCalls, wantError = 1, "execution probe reached"
			}
			if err == nil || !strings.Contains(stored.Error, wantError) || stored.Status != model.TaskStatusFailed || probe.calls != wantCalls || stored.CompletedAt == nil || stored.LeaseOwner != "" {
				t.Errorf("queued channel rejection: err=%v status=%s error=%q calls=%d", err, stored.Status, stored.Error, probe.calls)
			}
		})
	}
}
