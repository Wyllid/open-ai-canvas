package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// DramaMotionItem 是成片上的一个图形元素：lowerThird 是人名条 / 地点条，overlay 是台标、角标等图片。
// 时间是集内时间；全部由本地 ffmpeg 烧进成片，不调用模型。
type DramaMotionItem struct {
	Kind       string `json:"kind"`
	StartMs    int64  `json:"startMs"`
	DurationMs int64  `json:"durationMs"`
	// Title/Subtitle 用于 lowerThird。
	Title    string `json:"title,omitempty"`
	Subtitle string `json:"subtitle,omitempty"`
	// ResourceID/Position/WidthPct 用于 overlay；WidthPct 是相对画面宽度的百分比。
	ResourceID string  `json:"resourceId,omitempty"`
	Position   string  `json:"position,omitempty"`
	WidthPct   float64 `json:"widthPct,omitempty"`
}

// SetDramaMotionRequest 整体替换一集的图形元素；空列表表示不加任何图形。
type SetDramaMotionRequest struct {
	Items []DramaMotionItem `json:"items"`
}

const (
	DramaMotionLowerThird = "lowerThird"
	DramaMotionOverlay    = "overlay"
	dramaMaxMotionItems   = 32
	dramaOverlayWidthPct  = 18
)

func decodeDramaMotion(raw string) []DramaMotionItem {
	var items []DramaMotionItem
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &items) != nil {
		return []DramaMotionItem{}
	}
	return items
}

// SetDramaMotion 校验并保存一集的图形元素。已有成片时标记为过期，由调度循环重新合成。
func (s *Service) SetDramaMotion(userID, projectID, episodeID string, req SetDramaMotionRequest) ([]DramaMotionItem, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	if len(req.Items) > dramaMaxMotionItems {
		return nil, BadAuthRequest(fmt.Sprintf("an episode can have at most %d graphics", dramaMaxMotionItems))
	}
	items := make([]DramaMotionItem, 0, len(req.Items))
	for i, item := range req.Items {
		n := i + 1
		if item.StartMs < 0 || item.DurationMs < 500 || item.DurationMs > 600000 {
			return nil, BadAuthRequest(fmt.Sprintf("graphic %d: start cannot be negative and the duration must be between 500 ms and 10 minutes", n))
		}
		switch item.Kind {
		case DramaMotionLowerThird:
			item.Title, item.Subtitle = strings.TrimSpace(item.Title), strings.TrimSpace(item.Subtitle)
			if item.Title == "" || utf8.RuneCountInString(item.Title) > 40 || utf8.RuneCountInString(item.Subtitle) > 60 {
				return nil, BadAuthRequest(fmt.Sprintf("graphic %d: a lower third needs a title of up to 40 characters and a subtitle of up to 60", n))
			}
			item.ResourceID, item.Position, item.WidthPct = "", "", 0
		case DramaMotionOverlay:
			item.ResourceID = strings.TrimSpace(item.ResourceID)
			resource, err := s.repo.ResourceForUser(productionRow.UserID, item.ResourceID)
			if err != nil || resource == nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "image/") {
				return nil, BadAuthRequest(fmt.Sprintf("graphic %d: resourceId must be a ready image resource", n))
			}
			if item.Position == "" {
				item.Position = "top-right"
			}
			if !containsString(renderOverlayPositions, item.Position) {
				return nil, BadAuthRequest(fmt.Sprintf("graphic %d: position must be one of %s", n, strings.Join(renderOverlayPositions, ", ")))
			}
			if item.WidthPct == 0 {
				item.WidthPct = dramaOverlayWidthPct
			}
			if item.WidthPct < 5 || item.WidthPct > 60 {
				return nil, BadAuthRequest(fmt.Sprintf("graphic %d: widthPct must be between 5 and 60", n))
			}
			item.Title, item.Subtitle = "", ""
		default:
			return nil, BadAuthRequest(fmt.Sprintf("graphic %d: kind must be lowerThird or overlay", n))
		}
		items = append(items, item)
	}
	payload, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{"motion_json": string(payload)}
	if episode.FinalResourceID != "" {
		fields["final_stale"] = true
	}
	if err := s.repo.UpdateDramaEpisodeUser(episode.ID, fields); err != nil {
		return nil, err
	}
	if episode.FinalResourceID != "" {
		if err := s.reopenDrama(productionRow); err != nil {
			return nil, err
		}
	}
	return items, nil
}

// withDramaMotion 把人名条放到 text 轨、图片放到 overlay 轨；超出成片总长的部分裁掉。
func withDramaMotion(timeline renderProject, items []DramaMotionItem) renderProject {
	visible := true
	added := map[string]bool{}
	for i, item := range items {
		if item.StartMs >= timeline.DurationMs {
			continue
		}
		duration := min(item.DurationMs, timeline.DurationMs-item.StartMs)
		var clip renderClip
		switch item.Kind {
		case DramaMotionLowerThird:
			clip = renderClip{ID: fmt.Sprintf("title-%d", i), Kind: "text", TrackID: "titles", Graphic: renderGraphicLowerThird, Text: item.Title, Subtext: item.Subtitle}
		case DramaMotionOverlay:
			clip = renderClip{ID: fmt.Sprintf("overlay-%d", i), Kind: "image", TrackID: "overlays", Overlay: &renderOverlay{Position: item.Position, WidthPct: item.WidthPct}}
			clip.DirectMedia = &struct {
				ID         string `json:"id"`
				Kind       string `json:"kind"`
				StorageKey string `json:"storageKey"`
			}{item.ResourceID, "image", "resource:" + item.ResourceID}
		default:
			continue
		}
		clip.StartMs, clip.DurationMs, clip.SourceDurationMs = item.StartMs, duration, duration
		if !added[clip.TrackID] {
			added[clip.TrackID] = true
			timeline.Tracks = append(timeline.Tracks, renderTrack{ID: clip.TrackID, Kind: clip.Kind, Visible: &visible})
		}
		timeline.Clips = append(timeline.Clips, clip)
	}
	return timeline
}
