package app

import (
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// Segment boundaries. A continuous boundary starts the next segment from the
// previous segment's last frame; a reanchored one starts from the cast
// references alone, so a new scene is not dragged into the previous image and
// the segment does not have to wait for the previous video.
const (
	dramaContinuityContinuous = "continuous"
	dramaContinuityReanchor   = "reanchor"
	// dramaContinuityStartFrame 表示本段从用户指定的起幅画面开始（例如预演渲染），不接上一段。
	dramaContinuityStartFrame = "start_frame"
)

// dramaSegmentContinuity decides how segment segmentIndex joins the one before it.
// In auto mode the boundary is reanchored when the scene changes or the shot
// enters through a fade; chain mode keeps the old behaviour of always chaining.
func dramaSegmentContinuity(settings DramaSettings, shots []model.DramaShot, segmentIndex int) string {
	if segmentIndex <= 0 {
		return dramaContinuityReanchor
	}
	if settings.Storyboard.Normalized().Continuity == production.ContinuityChain {
		return dramaContinuityContinuous
	}
	last, first, ok := dramaBoundaryShots(shots, segmentIndex)
	if !ok {
		return dramaContinuityContinuous
	}
	if transition := settings.Storyboard.EffectiveTransition(first.Transition, false); transition != production.TransitionCut {
		return dramaContinuityReanchor
	}
	if !dramaSameScene(last, first) {
		return dramaContinuityReanchor
	}
	return dramaContinuityContinuous
}

// dramaBoundaryShots returns the last shot of segment index-1 and the first shot of segment index.
func dramaBoundaryShots(shots []model.DramaShot, segmentIndex int) (model.DramaShot, model.DramaShot, bool) {
	var last, first model.DramaShot
	hasLast, hasFirst := false, false
	for _, shot := range shots {
		switch shot.SegmentIndex {
		case segmentIndex - 1:
			if !hasLast || shot.Position > last.Position {
				last, hasLast = shot, true
			}
		case segmentIndex:
			if !hasFirst || shot.Position < first.Position {
				first, hasFirst = shot, true
			}
		}
	}
	return last, first, hasLast && hasFirst
}

func dramaSameScene(a, b model.DramaShot) bool {
	if a.SceneCastID != "" && b.SceneCastID != "" {
		return a.SceneCastID == b.SceneCastID
	}
	left, right := strings.TrimSpace(a.Scene), strings.TrimSpace(b.Scene)
	// Without a scene on either side there is nothing to compare; keep the chain.
	return left == "" || right == "" || left == right
}

// dramaChainedPrevious returns the segment whose last frame this segment starts
// from, or nil when the boundary is reanchored or the segment has its own start frame.
func dramaChainedPrevious(settings DramaSettings, shots []model.DramaShot, segments []model.DramaSegment, index int) *model.DramaSegment {
	if index <= 0 || index >= len(segments) || segments[index].StartFrameResourceID != "" {
		return nil
	}
	if dramaSegmentContinuity(settings, shots, segments[index].SegmentIndex) != dramaContinuityContinuous {
		return nil
	}
	return &segments[index-1]
}

// dramaBoundaryFades turns the transition into each segment into colour fades on
// the rendered clips: half the transition time fading out of the previous clip
// and half fading into the next for a black fade, a short flash for white.
func dramaBoundaryFades(settings DramaSettings, shots []model.DramaShot, segments []model.DramaSegment) (fadeIn, fadeOut map[string]dramaFade) {
	fadeIn, fadeOut = map[string]dramaFade{}, map[string]dramaFade{}
	storyboard := settings.Storyboard.Normalized()
	total := int64(storyboard.TransitionMs)
	for i := 1; i < len(segments); i++ {
		_, first, ok := dramaBoundaryShots(shots, segments[i].SegmentIndex)
		if !ok {
			continue
		}
		switch storyboard.EffectiveTransition(first.Transition, false) {
		case production.TransitionBlack:
			fadeOut[segments[i-1].ID] = dramaFade{Ms: total / 2, Color: "black"}
			fadeIn[segments[i].ID] = dramaFade{Ms: total - total/2, Color: "black"}
		case production.TransitionWhite:
			fadeOut[segments[i-1].ID] = dramaFade{Ms: total / 3, Color: "white"}
			fadeIn[segments[i].ID] = dramaFade{Ms: total - total/3, Color: "white"}
		}
	}
	return fadeIn, fadeOut
}

type dramaFade struct {
	Ms    int64
	Color string
}
