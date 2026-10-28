package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// 剧情段视频每生成一次就多一版（DramaTake kind=video），旧版不会被覆盖。
// 用户可以挑选哪一版进入成片，并给每一版记下审阅结论；审阅从不触发重新生成。

const (
	DramaTakeApprove   = "approve"
	DramaTakeFixPrompt = "fix_prompt"
	DramaTakeNewTake   = "new_take"

	dramaTakeKindVideo   = "video"
	dramaMaxTakeFrames   = 6
	dramaTakeFrameWidth  = 640
	dramaTakeReviewRunes = 4000
)

// DramaTakeReview 是对一版段视频的审阅：通过、改提示词，或需要重新生成（说明原因）。
type DramaTakeReview struct {
	Verdict    string `json:"verdict"`
	Score      int    `json:"score,omitempty"`
	Notes      string `json:"notes,omitempty"`
	PromptFix  string `json:"promptFix,omitempty"`
	Reviewer   string `json:"reviewer,omitempty"`
	ReviewedAt string `json:"reviewedAt,omitempty"`
}

// DramaTakeView 是剧情段的一版视频；Selected 表示当前进入成片的那一版。
type DramaTakeView struct {
	ID         string           `json:"id"`
	Version    int              `json:"version"`
	ResourceID string           `json:"resourceId"`
	DurationMs int64            `json:"durationMs"`
	CreatedAt  time.Time        `json:"createdAt"`
	Selected   bool             `json:"selected"`
	Review     *DramaTakeReview `json:"review,omitempty"`
}

// DramaTakeSelection 是选版结果；Warning 提醒下一段是从上一版的尾帧生成的。
type DramaTakeSelection struct {
	SegmentID string `json:"segmentId"`
	TakeID    string `json:"takeId"`
	Changed   bool   `json:"changed"`
	Warning   string `json:"warning,omitempty"`
}

func decodeDramaTakeReview(raw string) *DramaTakeReview {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var review DramaTakeReview
	if json.Unmarshal([]byte(raw), &review) != nil || review.Verdict == "" {
		return nil
	}
	return &review
}

// attachDramaTakes 给每个剧情段挂上它的全部视频版本，新版本在前。
func (s *Service) attachDramaTakes(views []DramaSegmentView) error {
	ids := make([]string, 0, len(views))
	for _, view := range views {
		ids = append(ids, view.ID)
	}
	takes, err := s.repo.DramaTakesForOwners(ids, dramaTakeKindVideo)
	if err != nil {
		return err
	}
	byOwner := map[string][]model.DramaTake{}
	for _, take := range takes {
		byOwner[take.OwnerID] = append(byOwner[take.OwnerID], take)
	}
	for i := range views {
		view := &views[i]
		view.Takes = []DramaTakeView{}
		for _, take := range byOwner[view.ID] {
			view.Takes = append(view.Takes, DramaTakeView{
				ID: take.ID, Version: take.Version, ResourceID: take.ResourceID, DurationMs: take.DurationMs, CreatedAt: take.CreatedAt,
				Selected: take.ResourceID != "" && take.ResourceID == view.VideoResourceID, Review: decodeDramaTakeReview(take.ReviewJSON),
			})
		}
	}
	return nil
}

func (s *Service) dramaVideoTake(userID, projectID, takeID string) (*model.Project, *model.DramaProduction, *model.DramaTake, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, nil, nil, err
	}
	take, err := s.repo.DramaTake(project.ID, strings.TrimSpace(takeID))
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (take.Kind != dramaTakeKindVideo || take.ResourceID == "")) {
		return nil, nil, nil, NotFound("take not found")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	return project, productionRow, take, nil
}

// ReviewDramaTake 记下对一版段视频的审阅结论；verdict 为空表示清除审阅。
func (s *Service) ReviewDramaTake(userID, projectID, takeID string, review DramaTakeReview) (*DramaTakeReview, error) {
	_, _, take, err := s.dramaVideoTake(userID, projectID, takeID)
	if err != nil {
		return nil, err
	}
	review.Verdict = strings.TrimSpace(review.Verdict)
	if review.Verdict == "" {
		return nil, s.repo.UpdateDramaTakeReview(take.ID, "")
	}
	switch review.Verdict {
	case DramaTakeApprove, DramaTakeFixPrompt, DramaTakeNewTake:
	default:
		return nil, BadAuthRequest("verdict must be approve, fix_prompt or new_take")
	}
	if review.Score < 0 || review.Score > 5 {
		return nil, BadAuthRequest("score must be between 1 and 5")
	}
	review.Notes, review.PromptFix, review.Reviewer = strings.TrimSpace(review.Notes), strings.TrimSpace(review.PromptFix), strings.TrimSpace(review.Reviewer)
	if utf8.RuneCountInString(review.Notes) > dramaTakeReviewRunes || utf8.RuneCountInString(review.PromptFix) > dramaTakeReviewRunes {
		return nil, BadAuthRequest(fmt.Sprintf("notes and promptFix can have at most %d characters", dramaTakeReviewRunes))
	}
	if utf8.RuneCountInString(review.Reviewer) > 40 {
		return nil, BadAuthRequest("reviewer can have at most 40 characters")
	}
	if review.Verdict != DramaTakeApprove && review.Notes == "" {
		return nil, BadAuthRequest("say what is wrong in notes when the take is not approved")
	}
	review.ReviewedAt = time.Now().UTC().Format(time.RFC3339)
	payload, err := json.Marshal(review)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateDramaTakeReview(take.ID, string(payload)); err != nil {
		return nil, err
	}
	return &review, nil
}

// SelectDramaTake 让某一版段视频进入成片：重新抽尾帧，已有成片标记过期并重新合成。
// 不会生成新视频，也不会让后续段过期；下一段若接的是旧版尾帧，结果里会给出提醒。
func (s *Service) SelectDramaTake(userID, projectID, takeID string) (DramaTakeSelection, error) {
	project, productionRow, take, err := s.dramaVideoTake(userID, projectID, takeID)
	if err != nil {
		return DramaTakeSelection{}, err
	}
	segment, err := s.repo.DramaSegment(project.ID, take.OwnerID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DramaTakeSelection{}, NotFound("the segment of this take no longer exists")
	}
	if err != nil {
		return DramaTakeSelection{}, err
	}
	selection := DramaTakeSelection{SegmentID: segment.ID, TakeID: take.ID}
	if segment.VideoStatus == model.DramaMediaQueued || segment.VideoStatus == model.DramaMediaRunning {
		return selection, BadAuthRequest("a new video is queued or running for this segment; pick a take after it finishes")
	}
	if segment.VideoResourceID == take.ResourceID && segment.VideoStatus == model.DramaMediaReady {
		return selection, nil
	}
	tail, err := s.extractDramaTailFrame(productionRow.UserID, take.ResourceID)
	if err != nil {
		return selection, err
	}
	seconds := int(take.DurationMs / 1000)
	if seconds <= 0 {
		seconds = segment.VideoSeconds
	}
	updated, err := s.repo.UpdateDramaSegmentRevision(segment.ID, segment.Revision, map[string]any{
		"video_resource_id": take.ResourceID, "video_seconds": seconds, "tail_frame_resource_id": tail, "video_status": model.DramaMediaReady, "video_error": "",
	})
	if err != nil {
		return selection, err
	}
	if !updated {
		return selection, BadAuthRequest("the segment changed while picking the take; try again")
	}
	selection.Changed = true
	episode, err := s.repo.DramaEpisode(project.ID, segment.EpisodeID)
	if err != nil {
		return selection, err
	}
	if episode.FinalResourceID != "" {
		if err := s.repo.UpdateDramaEpisodeUser(episode.ID, map[string]any{"final_stale": true}); err != nil {
			return selection, err
		}
		// 重新合成只跑本地 ffmpeg；暂停中的制作保持暂停。
		if err := s.reopenDrama(productionRow); err != nil {
			return selection, err
		}
	}
	selection.Warning, err = s.dramaNextSegmentChainWarning(productionRow, episode.ID, segment.ID)
	return selection, err
}

func (s *Service) dramaNextSegmentChainWarning(productionRow *model.DramaProduction, episodeID, segmentID string) (string, error) {
	rows, err := s.repo.DramaSegments(episodeID)
	if err != nil {
		return "", err
	}
	shots, err := s.repo.DramaShots(episodeID)
	if err != nil {
		return "", err
	}
	settings := parseDramaSettings(productionRow.SettingsJSON)
	for i := 0; i+1 < len(rows); i++ {
		if rows[i].ID != segmentID {
			continue
		}
		next := rows[i+1]
		if previous := dramaChainedPrevious(settings, shots, rows, i+1); previous != nil && previous.ID == segmentID && next.VideoStatus == model.DramaMediaReady {
			return fmt.Sprintf("Segment %d starts from the last frame of the take that was used before. Check that cut, and regenerate segment %d if it jumps.", next.SegmentIndex+1, next.SegmentIndex+1), nil
		}
	}
	return "", nil
}

// DramaTakeFrames 从一版段视频里均匀抽几帧 JPEG，供有视觉能力的智能体审阅。
func (s *Service) DramaTakeFrames(userID, projectID, takeID string, count int) (*DramaTakeView, [][]byte, error) {
	_, productionRow, take, err := s.dramaVideoTake(userID, projectID, takeID)
	if err != nil {
		return nil, nil, err
	}
	if count <= 0 {
		count = 4
	}
	count = min(count, dramaMaxTakeFrames)
	frames, err := s.extractDramaTakeFrames(productionRow.UserID, take.ResourceID, take.DurationMs, count)
	if err != nil {
		return nil, nil, err
	}
	view := DramaTakeView{ID: take.ID, Version: take.Version, ResourceID: take.ResourceID, DurationMs: take.DurationMs, CreatedAt: take.CreatedAt, Review: decodeDramaTakeReview(take.ReviewJSON)}
	return &view, frames, nil
}

func (s *Service) extractDramaTakeFrames(userID, resourceID string, durationMs int64, count int) ([][]byte, error) {
	if s.dramaTakeFramesHook != nil {
		return s.dramaTakeFramesHook(userID, resourceID, count)
	}
	ffmpegBin, err := renderFfmpegBinary()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "yingce-drama-frames-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	resource, input, err := s.downloadDramaVideo(userID, resourceID, dir)
	if err != nil {
		return nil, err
	}
	if durationMs <= 0 {
		durationMs = resource.DurationMs
	}
	if durationMs <= 0 {
		count = 1
	}
	frames := make([][]byte, 0, count)
	for i := range count {
		// 每帧取所在区间的中点，避开首尾的淡入淡出。
		at := float64(durationMs) / 1000 * (float64(i) + 0.5) / float64(count)
		output := filepath.Join(dir, fmt.Sprintf("frame-%d.jpg", i))
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		cmd := exec.CommandContext(ctx, ffmpegBin, "-hide_banner", "-loglevel", "error", "-ss", fmt.Sprintf("%.3f", at), "-i", input, "-frames:v", "1",
			"-vf", fmt.Sprintf("scale='min(%d,iw)':-2", dramaTakeFrameWidth), "-q:v", "5", "-y", output)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			return nil, fmt.Errorf("frame extraction failed: %s", clipText(strings.TrimSpace(string(out)), 400))
		}
		data, err := os.ReadFile(output)
		if err != nil {
			return nil, err
		}
		frames = append(frames, data)
	}
	return frames, nil
}
