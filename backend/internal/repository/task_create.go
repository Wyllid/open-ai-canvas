package repository

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var (
	ErrActiveTaskLimit   = errors.New("同时进行的任务数已达上限，请等待已有任务完成")
	ErrTaskNotRetryable  = errors.New("该任务当前状态不支持重试")
	ErrChannelModelInUse = errors.New("该渠道模型正在被使用，无法删除或停用")
)

func (r *Repository) CreateTaskWithActiveLimit(task *model.Task, activeTaskLimit int) error {
	return r.Transaction(func(repo *Repository) error {
		tx := repo.db
		if err := repo.requireCurrentCloudAgentParent(task); err != nil {
			return err
		}
		if err := New(tx).requireExclusiveCanvasAgent(task); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, task); err != nil {
			return err
		}
		if err := enforceActiveTaskLimit(tx, task.UserID, activeTaskLimit); err != nil {
			return err
		}
		if err := tx.Create(task).Error; err != nil {
			return err
		}
		if task.Operation == "cloud_agent" && task.ProjectID != "" {
			repo.canvasChanged(task.UserID, task.ProjectID)
		}
		return nil
	})
}

func (r *Repository) RetryTask(userID string, prepared *model.Task, activeTaskLimit int) (*model.Task, error) {
	var task model.Task
	taskID := prepared.ID
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := enforceActiveTaskLimit(tx, userID, activeTaskLimit); err != nil {
			return err
		}
		updates := map[string]any{
			"status": model.TaskStatusQueued, "stage": "等待队列调度", "progress": 5, "error": "", "result_json": "",
			"execution_diagnostic_json": "", "cancellation_source": "", "cancellation_actor_id": "", "cancellation_requested_at": nil,
			"text_draft": "", "started_at": nil, "completed_at": nil,
			"provider_request_id": "", "poll_stage": "", "next_poll_at": nil,
			"provider_cancel_status": "", "provider_cancel_error": "", "provider_cancel_attempts": 0,
			"provider_cancel_requested_at": nil, "provider_cancelled_at": nil, "provider_cancel_next_check_at": nil,
			"route_run":                 gorm.Expr("route_run + ?", 1),
			"logical_model_revision_id": prepared.LogicalModelRevisionID, "route_id": prepared.RouteID,
			"channel_model_id": prepared.ChannelModelID, "input_json": prepared.InputJSON,
			"model": prepared.Model, "provider": prepared.Provider,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now(),
		}
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND user_id = ? AND status IN ?", taskID, userID, []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled}).
			Updates(updates)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskNotRetryable
		}
		if err := tx.Delete(&model.TaskTextDelta{}, "user_id = ? AND task_id = ?", userID, taskID).Error; err != nil {
			return err
		}
		return tx.First(&task, "id = ? AND user_id = ?", taskID, userID).Error
	})
	return &task, err
}

func enforceActiveTaskLimit(tx *gorm.DB, userID string, activeTaskLimit int) error {
	var count int64
	if err := tx.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error; err != nil {
		return err
	}
	if count >= int64(activeTaskLimit) {
		return ErrActiveTaskLimit
	}
	return nil
}

func newRepositoryID() string {
	return randomRepositorySuffix()
}

func randomRepositorySuffix() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(value[:])
}
