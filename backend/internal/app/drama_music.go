package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// DramaMusicCue 是一集成片里的一段配乐：引用一个音频资源，按集内时间放到音乐轨上。
// 音乐轨在人声下自动压低，成片总线统一做响度归一。
type DramaMusicCue struct {
	Label         string  `json:"label,omitempty"`
	ResourceID    string  `json:"resourceId"`
	StartMs       int64   `json:"startMs"`
	DurationMs    int64   `json:"durationMs"`
	SourceStartMs int64   `json:"sourceStartMs,omitempty"`
	Volume        float64 `json:"volume,omitempty"`
}

// SetDramaMusicRequest 整体替换一集的配乐；空列表表示这一集不用音乐。
type SetDramaMusicRequest struct {
	Cues []DramaMusicCue `json:"cues"`
}

const (
	dramaMaxMusicCues = 32
	// dramaMusicVolume 是未指定音量时的配乐电平（约 -9 dB），人声出现时再由 ducking 压低。
	dramaMusicVolume = 0.35
	// dramaLoudnessLUFS 是短剧成片的总线响度目标，适合线上视频平台。
	dramaLoudnessLUFS = -14
)

func decodeDramaMusicCues(raw string) []DramaMusicCue {
	var cues []DramaMusicCue
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &cues) != nil {
		return []DramaMusicCue{}
	}
	return cues
}

// SetDramaMusic 校验并保存一集的配乐。已有成片时标记为过期，由调度循环重新合成。
func (s *Service) SetDramaMusic(userID, projectID, episodeID string, req SetDramaMusicRequest) ([]DramaMusicCue, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	if len(req.Cues) > dramaMaxMusicCues {
		return nil, BadAuthRequest(fmt.Sprintf("an episode can have at most %d music cues", dramaMaxMusicCues))
	}
	cues := make([]DramaMusicCue, 0, len(req.Cues))
	for i, cue := range req.Cues {
		cue.Label = strings.TrimSpace(cue.Label)
		if utf8.RuneCountInString(cue.Label) > 40 {
			return nil, BadAuthRequest(fmt.Sprintf("music cue %d: the label can have at most 40 characters", i+1))
		}
		cue.ResourceID = strings.TrimSpace(cue.ResourceID)
		if cue.StartMs < 0 || cue.DurationMs < 500 || cue.SourceStartMs < 0 {
			return nil, BadAuthRequest(fmt.Sprintf("music cue %d: times cannot be negative and the duration must be at least 500 ms", i+1))
		}
		if cue.Volume < 0 || cue.Volume > 2 {
			return nil, BadAuthRequest(fmt.Sprintf("music cue %d: volume must be between 0 and 2", i+1))
		}
		resource, err := s.repo.ResourceForUser(productionRow.UserID, cue.ResourceID)
		if err != nil || resource == nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "audio/") {
			return nil, BadAuthRequest(fmt.Sprintf("music cue %d: resourceId must be a ready audio resource", i+1))
		}
		cues = append(cues, cue)
	}
	payload, err := json.Marshal(cues)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{"music_cues_json": string(payload)}
	if episode.FinalResourceID != "" {
		fields["final_stale"] = true
	}
	if err := s.repo.UpdateDramaEpisodeUser(episode.ID, fields); err != nil {
		return nil, err
	}
	if episode.FinalResourceID != "" {
		// 重新合成只跑本地 ffmpeg；暂停中的制作保持暂停。
		if err := s.reopenDrama(productionRow); err != nil {
			return nil, err
		}
	}
	return cues, nil
}

// withDramaMusic 为成片加一条 music 音频轨；没有配乐时时间线不变。
func withDramaMusic(timeline renderProject, cues []DramaMusicCue) renderProject {
	clips := dramaMusicClips(cues, timeline.DurationMs)
	if len(clips) == 0 {
		return timeline
	}
	visible := true
	timeline.Tracks = append(timeline.Tracks, renderTrack{ID: "music", Kind: "audio", Visible: &visible, Role: renderTrackRoleMusic})
	timeline.Clips = append(timeline.Clips, clips...)
	return timeline
}

// DramaAudioResource 是可用作配乐的音频资源；不含存储地址或签名链接。
type DramaAudioResource struct {
	ID         string `json:"id"`
	MimeType   string `json:"mimeType"`
	DurationMs int64  `json:"durationMs"`
	CreatedAt  string `json:"createdAt"`
}

// DramaAudioResources 列出用户最近上传或生成的音频资源，供挑选配乐。
func (s *Service) DramaAudioResources(userID string, limit int) ([]DramaAudioResource, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	resources, err := s.repo.Resources(userID, 500)
	if err != nil {
		return nil, err
	}
	out := make([]DramaAudioResource, 0, limit)
	for _, resource := range resources {
		if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "audio/") {
			continue
		}
		out = append(out, DramaAudioResource{ID: resource.ID, MimeType: resource.MimeType, DurationMs: resource.DurationMs, CreatedAt: resource.CreatedAt.UTC().Format(time.RFC3339)})
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

// dramaMusicClips 把配乐放到 music 轨上，超出成片总长的部分裁掉。
func dramaMusicClips(cues []DramaMusicCue, totalMs int64) []renderClip {
	clips := make([]renderClip, 0, len(cues))
	for i, cue := range cues {
		if cue.ResourceID == "" || cue.StartMs >= totalMs {
			continue
		}
		duration := min(cue.DurationMs, totalMs-cue.StartMs)
		volume := cue.Volume
		if volume <= 0 {
			volume = dramaMusicVolume
		}
		clip := renderClip{ID: fmt.Sprintf("music-%d", i), Kind: "audio", TrackID: "music", StartMs: cue.StartMs, DurationMs: duration, SourceStartMs: cue.SourceStartMs, SourceDurationMs: duration, Volume: volume}
		clip.DirectMedia = &struct {
			ID         string `json:"id"`
			Kind       string `json:"kind"`
			StorageKey string `json:"storageKey"`
		}{cue.ResourceID, "audio", "resource:" + cue.ResourceID}
		clips = append(clips, clip)
	}
	return clips
}
