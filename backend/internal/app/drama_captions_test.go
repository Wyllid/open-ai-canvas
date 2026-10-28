package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestAutoDramaCaptionsFollowSegmentVideoLength(t *testing.T) {
	shots := []model.DramaShot{
		{ID: "a", SegmentIndex: 0, Position: 0, DurationMs: 3000, Dialogue: "（冷笑）我今日来，是要当众退婚。"},
		{ID: "b", SegmentIndex: 0, Position: 1, DurationMs: 3000},
		{ID: "c", SegmentIndex: 1, Position: 2, DurationMs: 4000, Dialogue: "You will regret this."},
	}
	// 第一段计划 6 秒、视频 12 秒：镜头时间等比放大两倍；第二段从 12 秒开始。
	segments := []model.DramaSegment{{SegmentIndex: 1, VideoSeconds: 4}, {SegmentIndex: 0, VideoSeconds: 12}}
	cues := autoDramaCaptions(segments, shots)
	if len(cues) != 2 {
		t.Fatalf("cues = %+v", cues)
	}
	first, second := cues[0], cues[1]
	if first.ShotID != "a" || first.Text != "我今日来，是要当众退婚。" || first.StartMs != 250 || first.StartMs+first.DurationMs != 6000-150 {
		t.Fatalf("first cue must drop the stage direction and fit inside the scaled shot: %+v", first)
	}
	if second.ShotID != "c" || second.StartMs != 12000+250 || second.StartMs+second.DurationMs != 16000-150 {
		t.Fatalf("second segment starts after the first one's video: %+v", second)
	}
	if got := len(first.Words); got != 10 || first.Words[3].Text != "来，" {
		t.Fatalf("CJK words are single characters with punctuation attached: %+v", first.Words)
	}
	if words := second.Words; len(words) != 4 || words[0].Text != "You " || words[3].Text != "this." {
		t.Fatalf("latin words split on spaces: %+v", words)
	}
	last := first.Words[len(first.Words)-1]
	if last.StartMs+last.DurationMs != first.DurationMs {
		t.Fatalf("word timings must fill the cue: %+v", first.Words)
	}
}

func TestSplitDramaCaptionBreaksLongLines(t *testing.T) {
	cues := splitDramaCaption("s", "三年前你害我家破人亡，今日我回来了。这一笔账，我们慢慢算！", 1000, 6000)
	if len(cues) < 2 {
		t.Fatalf("a long line must become several captions: %+v", cues)
	}
	if cues[0].StartMs != 1000 || cues[len(cues)-1].StartMs+cues[len(cues)-1].DurationMs != 7000 {
		t.Fatalf("captions must cover the line's time exactly: %+v", cues)
	}
	var joined strings.Builder
	for i, cue := range cues {
		joined.WriteString(cue.Text)
		if i > 0 && cue.StartMs != cues[i-1].StartMs+cues[i-1].DurationMs {
			t.Fatalf("captions must be back to back: %+v", cues)
		}
	}
	if joined.String() != "三年前你害我家破人亡，今日我回来了。这一笔账，我们慢慢算！" {
		t.Fatalf("splitting must keep every character: %q", joined.String())
	}
}

func TestNormalizeDramaCaptionCuesKeepsOnlyMatchingWordTimings(t *testing.T) {
	cues, err := normalizeDramaCaptionCues([]DramaCaptionCue{
		{StartMs: 5000, DurationMs: 1000, Text: "第二条"},
		{StartMs: 0, DurationMs: 1000, Text: "hello world", Words: []DramaCaptionWord{{Text: "hello ", StartMs: 0, DurationMs: 400}, {Text: "world", StartMs: 600, DurationMs: 400}}},
		{StartMs: 2000, DurationMs: 1000, Text: "改过的字", Words: []DramaCaptionWord{{Text: "旧", StartMs: 0, DurationMs: 1000}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if cues[0].Text != "hello world" || cues[0].Words[1].StartMs != 600 {
		t.Fatalf("captions sort by start and keep word timings that spell the text: %+v", cues)
	}
	if len(cues[1].Words) != 4 || cues[1].Words[0].Text != "改" {
		t.Fatalf("word timings that no longer match the text are estimated again: %+v", cues[1].Words)
	}
	if _, err := normalizeDramaCaptionCues([]DramaCaptionCue{{StartMs: 0, DurationMs: 100, Text: "x"}}); err == nil {
		t.Fatal("a too short caption must be refused")
	}
	if _, err := normalizeDramaCaptionCues([]DramaCaptionCue{{StartMs: 0, DurationMs: 1000, Text: "  "}}); err == nil {
		t.Fatal("an empty caption must be refused")
	}
}

func TestDramaCaptionsAndMotionRenderAgainWithoutNewVideos(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0]
	if episode.Stage != model.DramaEpisodeDone || len(fake.renders) == 0 {
		t.Fatalf("episode must be rendered first: %+v", episode)
	}
	first := fake.renders[len(fake.renders)-1]
	var subtitles int
	for _, clip := range first.Clips {
		if clip.Kind == "subtitle" {
			subtitles++
		}
	}
	if subtitles == 0 || first.Captions == nil || first.Captions.Burn {
		t.Fatalf("automatic captions go to the SRT but are not burned by default: %+v", first)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil || detail.Captions.Edited || !detail.Captions.EstimatedTiming || detail.Captions.SRT == "" || len(detail.Motion) != 0 {
		t.Fatalf("detail captions: %+v %v", detail.Captions, err)
	}

	burn := true
	if _, err := svc.SetDramaCaptions("usr-drama", project, episode.ID, SetDramaCaptionsRequest{Style: "bouncy"}); err == nil {
		t.Fatal("an unknown style must be refused")
	}
	edited := append([]DramaCaptionCue(nil), detail.Captions.Cues...)
	edited[0].Text = "改写后的第一句"
	view, err := svc.SetDramaCaptions("usr-drama", project, episode.ID, SetDramaCaptionsRequest{Burn: &burn, Style: renderCaptionKaraoke, Cues: edited})
	if err != nil || !view.Edited || view.EstimatedTiming || view.Cues[0].Text != "改写后的第一句" || !strings.Contains(view.SRT, "改写后的第一句") {
		t.Fatalf("edited captions: %+v %v", view, err)
	}

	image := fake.resource("usr-drama", "image", "image/png")
	audio := fake.resource("usr-drama", "media", "audio/mpeg")
	if _, err := svc.SetDramaMotion("usr-drama", project, episode.ID, SetDramaMotionRequest{Items: []DramaMotionItem{{Kind: DramaMotionOverlay, ResourceID: audio, StartMs: 0, DurationMs: 1000}}}); err == nil {
		t.Fatal("an audio resource must be refused as an overlay")
	}
	if _, err := svc.SetDramaMotion("usr-drama", project, episode.ID, SetDramaMotionRequest{Items: []DramaMotionItem{{Kind: DramaMotionOverlay, ResourceID: image, Position: "middle", StartMs: 0, DurationMs: 1000}}}); err == nil {
		t.Fatal("an unknown position must be refused")
	}
	if _, err := svc.SetDramaMotion("usr-drama", project, episode.ID, SetDramaMotionRequest{Items: []DramaMotionItem{{Kind: DramaMotionLowerThird, StartMs: 0, DurationMs: 1000}}}); err == nil {
		t.Fatal("a lower third without a title must be refused")
	}
	items, err := svc.SetDramaMotion("usr-drama", project, episode.ID, SetDramaMotionRequest{Items: []DramaMotionItem{
		{Kind: DramaMotionLowerThird, Title: " 林婉 ", Subtitle: "苏家大小姐", StartMs: 500, DurationMs: 3000},
		{Kind: DramaMotionOverlay, ResourceID: image, StartMs: 0, DurationMs: 300000},
		{Kind: DramaMotionLowerThird, Title: "too late", StartMs: 999000, DurationMs: 1000},
	}})
	if err != nil || len(items) != 3 || items[0].Title != "林婉" || items[1].Position != "top-right" || items[1].WidthPct != dramaOverlayWidthPct {
		t.Fatalf("set motion: %+v %v", items, err)
	}

	renders, videos := len(fake.renders), fake.byKind["video"]
	runDramaTicks(t, svc, project, 6)
	if fake.byKind["video"] != videos {
		t.Fatalf("captions and graphics must not generate new videos: %d -> %d", videos, fake.byKind["video"])
	}
	if len(fake.renders) != renders+1 {
		t.Fatalf("a stale final must be rendered again once: %d -> %d", renders, len(fake.renders))
	}
	timeline := fake.renders[len(fake.renders)-1]
	if timeline.Captions == nil || !timeline.Captions.Burn || timeline.Captions.Style != renderCaptionKaraoke {
		t.Fatalf("burn settings must reach the render: %+v", timeline.Captions)
	}
	var text, overlay []renderClip
	var caption renderClip
	for _, clip := range timeline.Clips {
		switch {
		case clip.Kind == "text":
			text = append(text, clip)
		case clip.Overlay != nil:
			overlay = append(overlay, clip)
		case clip.Kind == "subtitle" && caption.ID == "":
			caption = clip
		}
	}
	if len(text) != 1 || text[0].Subtext != "苏家大小姐" || len(overlay) != 1 || overlay[0].StartMs+overlay[0].DurationMs != timeline.DurationMs {
		t.Fatalf("graphics outside the episode are dropped and long ones trimmed: text=%+v overlay=%+v", text, overlay)
	}
	if caption.Text != "改写后的第一句" || len(caption.Words) == 0 {
		t.Fatalf("the edited caption with word timings must be rendered: %+v", caption)
	}
	plan := buildRenderPlan(timeline)
	if !strings.Contains(plan.ASS, "Karaoke") || !strings.Contains(plan.ASS, "林婉") || len(plan.VideoOverlays) != 1 {
		t.Fatalf("plan must burn karaoke captions and the lower third: %s", plan.ASS)
	}

	view, err = svc.SetDramaCaptions("usr-drama", project, episode.ID, SetDramaCaptionsRequest{Reset: true})
	if err != nil || view.Edited || !view.Burn || view.Cues[0].Text == "改写后的第一句" {
		t.Fatalf("reset goes back to automatic captions and keeps the burn setting: %+v %v", view, err)
	}
}
