package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// 成片画质增强（超分 / 插帧）：可选的付费后期，只在用户明确确认后对当前成片提交一次视频处理任务，
// 复用画布的画质增强模型与服务端 admission（源时长、尺寸、帧率档都由服务端重算）。
// 增强结果单独保存，不替换成片；成片重新合成后，旧的增强版标记为过期。

// DramaEnhanceRequest 提交一次成片增强。Confirm 必须为 true：增强按源时长计费。
type DramaEnhanceRequest struct {
	Model      DramaModelChoice `json:"model"`
	Resolution string           `json:"resolution"`
	// FPS 只在模型允许选择输出帧率（插帧）时有效；0 表示保持原帧率。
	FPS     int  `json:"fps,omitempty"`
	Confirm bool `json:"confirm"`
}

// DramaEnhanceState 存在 DramaEpisode.EnhanceJSON：最近一次增强的任务、来源成片与结果。
type DramaEnhanceState struct {
	TaskID           string           `json:"taskId"`
	SourceResourceID string           `json:"sourceResourceId"`
	Model            DramaModelChoice `json:"model"`
	Resolution       string           `json:"resolution"`
	FPS              int              `json:"fps,omitempty"`
	Status           string           `json:"status"`
	ResourceID       string           `json:"resourceId,omitempty"`
	Error            string           `json:"error,omitempty"`
	CreatedAt        time.Time        `json:"createdAt"`
	// Outdated 表示成片在增强之后重新合成过，增强版对应的是旧成片。
	Outdated bool `json:"outdated,omitempty"`
}

func decodeDramaEnhance(raw string) *DramaEnhanceState {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var state DramaEnhanceState
	if json.Unmarshal([]byte(raw), &state) != nil || state.TaskID == "" {
		return nil
	}
	return &state
}

func dramaEnhancePending(state *DramaEnhanceState) bool {
	return state != nil && (state.Status == string(model.TaskStatusQueued) || state.Status == string(model.TaskStatusRunning))
}

// EnhanceDramaFinal 对一集当前成片提交画质增强任务。
func (s *Service) EnhanceDramaFinal(userID, projectID, episodeID string, req DramaEnhanceRequest) (*DramaEnhanceState, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	if !req.Confirm {
		return nil, BadAuthRequest("upscaling is a paid generation billed by the video length; send confirm: true once the person has agreed")
	}
	if episode.FinalResourceID == "" || episode.FinalStale {
		return nil, BadAuthRequest("render the episode first; only an up-to-date final video can be upscaled")
	}
	if req.Model.ChannelID = strings.TrimSpace(req.Model.ChannelID); req.Model.ChannelID == "" || strings.TrimSpace(req.Model.ModelKey) == "" {
		return nil, BadAuthRequest("pick a video enhance model (channelId and modelKey)")
	}
	req.Resolution = strings.TrimSpace(req.Resolution)
	if req.Resolution == "" {
		return nil, BadAuthRequest("pick an output resolution")
	}
	current, err := s.refreshDramaEnhance(episode)
	if err != nil {
		return nil, err
	}
	if dramaEnhancePending(current) {
		return nil, BadAuthRequest("an upscale of this episode is already running")
	}
	final, err := s.repo.ResourceForUser(productionRow.UserID, episode.FinalResourceID)
	if err != nil || final == nil {
		return nil, errors.New("the final video is no longer available")
	}
	source := map[string]any{"id": "source", "name": "final.mp4", "type": final.MimeType, "mimeType": final.MimeType, "storageKey": "resource:" + final.ID, "role": "reference", "bytes": final.Size, "width": final.Width, "height": final.Height, "durationMs": final.DurationMs}
	config := map[string]any{"channelId": req.Model.ChannelID, "model": req.Model.ModelKey, "channelModelKey": req.Model.ModelKey, "vquality": req.Resolution, "taskWorkflowProvider": "model"}
	options := map[string]any{}
	if req.FPS > 0 {
		options["fps"] = req.FPS
	}
	protocol := ""
	if channelModel, err := s.repo.ChannelModelByKey(req.Model.ChannelID, req.Model.ModelKey); err == nil {
		protocol = string(channelModel.Protocol)
	}
	metadata := map[string]any{"dramaProjectId": project.ID, "dramaEpisodeId": episode.ID, "videoEditOperation": VideoProcessingOperationEnhance}
	if protocol != "" {
		metadata["providerOptions"] = map[string]any{protocol: options}
	}
	prompt := "画质增强（" + req.Resolution + "）"
	input := map[string]any{"mode": "video", "prompt": prompt, "config": config, "referenceVideos": []any{source}, "metadata": metadata}
	task, err := s.submitDramaTask(productionRow.UserID, CreateTaskRequest{ProjectID: project.ID, Type: "canvas_video", Operation: VideoProcessingOperationEnhance, Prompt: prompt, Model: req.Model.ModelKey, Input: input})
	if err != nil {
		return nil, err
	}
	state := &DramaEnhanceState{TaskID: task.ID, SourceResourceID: final.ID, Model: req.Model, Resolution: req.Resolution, FPS: req.FPS, Status: string(model.TaskStatusQueued), CreatedAt: time.Now().UTC()}
	if err := s.saveDramaEnhance(episode.ID, state); err != nil {
		return nil, err
	}
	// 任务状态一律由 refresh 从任务记录读取，这里只记下已提交。
	payload, _ := json.Marshal(state)
	episode.EnhanceJSON = string(payload)
	return s.refreshDramaEnhance(episode)
}

func (s *Service) saveDramaEnhance(episodeID string, state *DramaEnhanceState) error {
	stored := *state
	stored.Outdated = false
	payload, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	// 增强结果不改变剧本或成片，不递增版本，避免让调度中的合成结果失效。
	return s.repo.UpdateDramaEpisodeMeta(episodeID, map[string]any{"enhance_json": string(payload)})
}

// refreshDramaEnhance 读取增强任务的最新状态；任务结束时把结果写回本集。
func (s *Service) refreshDramaEnhance(episode *model.DramaEpisode) (*DramaEnhanceState, error) {
	state := decodeDramaEnhance(episode.EnhanceJSON)
	if state == nil {
		return nil, nil
	}
	if dramaEnhancePending(state) {
		task, err := s.repo.Task(state.TaskID)
		switch {
		case err != nil:
			state.Status, state.Error = string(model.TaskStatusFailed), "the upscale task is no longer available"
		case task.Status == model.TaskStatusSucceeded:
			state.Status, state.ResourceID = string(task.Status), dramaTaskResource(task)
			if state.ResourceID == "" {
				state.Status, state.Error = string(model.TaskStatusFailed), "the upscale task returned no video"
			}
		case task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled:
			state.Status, state.Error = string(model.TaskStatusFailed), firstNonEmpty(task.Error, "the upscale task failed")
		default:
			state.Status = string(task.Status)
		}
		if !dramaEnhancePending(state) {
			if err := s.saveDramaEnhance(episode.ID, state); err != nil {
				return nil, err
			}
		}
	}
	state.Outdated = state.SourceResourceID != episode.FinalResourceID
	return state, nil
}
