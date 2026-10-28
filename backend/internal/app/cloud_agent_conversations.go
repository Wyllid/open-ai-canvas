package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type CloudAgentConversation struct {
	ID             string    `json:"id"`
	CanvasID       string    `json:"canvasId"`
	Title          string    `json:"title"`
	LatestRunID    string    `json:"latestRunId"`
	Status         string    `json:"status"`
	Revision       int64     `json:"revision"`
	CleanupPending bool      `json:"cleanupPending"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CloudAgentConversationPage struct {
	Items      []CloudAgentConversation `json:"items"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}

type CloudAgentConversationRunPage struct {
	Items      []*CloudAgentRun `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

func cloudAgentHistoryCursor(value string, limit int) (*repository.CloudAgentHistoryCursor, error) {
	if limit < 1 || limit > 100 {
		return nil, BadAuthRequest("Conversation page size must be an integer between 1 and 100")
	}
	if value == "" {
		return nil, nil
	}
	if len(value) > 512 {
		return nil, BadAuthRequest("Invalid conversation page cursor")
	}
	data, err := base64.RawURLEncoding.DecodeString(value)
	var cursor repository.CloudAgentHistoryCursor
	if err != nil || json.Unmarshal(data, &cursor) != nil || cursor.CreatedAt.IsZero() || validateCloudAgentID(cursor.ID, "Turn ID", 80) != nil {
		return nil, BadAuthRequest("Invalid conversation page cursor")
	}
	return &cursor, nil
}

func encodeCloudAgentHistoryCursor(run model.CloudAgentExecution) string {
	data, _ := json.Marshal(repository.CloudAgentHistoryCursor{CreatedAt: run.CreatedAt, ID: run.ID})
	return base64.RawURLEncoding.EncodeToString(data)
}

// Canvas ownership is checked before directory lookup, including empty results.
// A conversation that visited this canvas retains its global latest turn.
func (s *Service) CloudAgentConversations(userID, canvasID, before string, limit int) (*CloudAgentConversationPage, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("Please sign in first")
	}
	if strings.TrimSpace(canvasID) == "" || validateCloudAgentID(canvasID, "Canvas ID", 80) != nil {
		return nil, BadAuthRequest("A valid canvas ID is required")
	}
	cursor, err := cloudAgentHistoryCursor(before, limit)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.CanvasProjectMetadataForUser(userID, canvasID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("Canvas not found")
		}
		return nil, err
	}
	rows, err := s.repo.CloudAgentConversations(userID, canvasID, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	page := &CloudAgentConversationPage{Items: []CloudAgentConversation{}}
	if len(rows) > limit {
		page.NextCursor = encodeCloudAgentHistoryCursor(rows[limit-1])
		rows = rows[:limit]
	}
	for _, run := range rows {
		page.Items = append(page.Items, cloudAgentConversationSummary(run))
	}
	return page, nil
}

func cloudAgentConversationSummary(run model.CloudAgentExecution) CloudAgentConversation {
	id := run.ConversationID
	if id == "" {
		id = run.ID
	}
	return CloudAgentConversation{
		ID: id, CanvasID: run.CanvasID, Title: run.Title, LatestRunID: run.ID,
		Status: run.Status, Revision: run.Revision, CleanupPending: run.CleanupPending,
		CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
	}
}

// CloudAgentConversationSummaryByID 返回单个对话的最新轮次摘要。
// 当前画布目录之外的已选对话靠它判断是否变化，避免每次轮询都重读全部轮次。
func (s *Service) CloudAgentConversationSummaryByID(userID, conversationID string) (*CloudAgentConversation, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("Please sign in first")
	}
	if err := validateCloudAgentID(conversationID, "Conversation ID", 80); err != nil {
		return nil, err
	}
	row, err := s.repo.CloudAgentConversationLatest(userID, conversationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("Agent conversation not found")
	}
	if err != nil {
		return nil, err
	}
	summary := cloudAgentConversationSummary(row)
	return &summary, nil
}

func (s *Service) CloudAgentConversationRuns(userID, conversationID, after string, limit int) (*CloudAgentConversationRunPage, error) {
	if userID == "" {
		return nil, kernel.Unauthorized("Please sign in first")
	}
	if err := validateCloudAgentID(conversationID, "Conversation ID", 80); err != nil {
		return nil, err
	}
	cursor, err := cloudAgentHistoryCursor(after, limit)
	if err != nil {
		return nil, err
	}
	exists, err := s.repo.CloudAgentConversationExists(userID, conversationID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, kernel.NotFound("Agent conversation not found")
	}
	rows, err := s.repo.CloudAgentConversationRuns(userID, conversationID, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	page := &CloudAgentConversationRunPage{Items: []*CloudAgentRun{}}
	if len(rows) > limit {
		page.NextCursor = encodeCloudAgentHistoryCursor(rows[limit-1])
		rows = rows[:limit]
	}
	for _, row := range rows {
		run, err := s.CloudAgentRun(userID, row.ID)
		if err != nil {
			return nil, err
		}
		page.Items = append(page.Items, run)
	}
	return page, nil
}
