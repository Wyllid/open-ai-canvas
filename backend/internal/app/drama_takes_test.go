package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaTakesCanBeReviewedAndPickedForTheCut(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0]
	if episode.Stage != model.DramaEpisodeDone {
		t.Fatalf("episode must be rendered first: %+v", episode)
	}
	if _, err := svc.GenerateDramaSegments("usr-drama", project, episode.ID, GenerateDramaSegmentsRequest{Segments: []int{1}}); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, project, 12)
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	takes := detail.Segments[1].Takes
	if len(takes) != 2 || takes[0].Version != 2 || !takes[0].Selected || takes[1].Selected {
		t.Fatalf("want two takes, newest selected: %+v", takes)
	}
	if len(detail.Segments[0].Takes) != 1 || !detail.Segments[0].Takes[0].Selected {
		t.Fatalf("first segment keeps its single take: %+v", detail.Segments[0].Takes)
	}
	old, renders, videos := takes[1], len(fake.renders), fake.byKind["video"]

	if _, err := svc.ReviewDramaTake("usr-drama", project, takes[0].ID, DramaTakeReview{Verdict: "maybe"}); err == nil {
		t.Fatal("unknown verdicts are refused")
	}
	if _, err := svc.ReviewDramaTake("usr-drama", project, takes[0].ID, DramaTakeReview{Verdict: DramaTakeNewTake}); err == nil {
		t.Fatal("a rejection needs notes")
	}
	if _, err := svc.ReviewDramaTake("usr-drama", project, takes[0].ID, DramaTakeReview{Verdict: DramaTakeNewTake, Score: 2, Notes: "Hands melt at 00:03.", Reviewer: "agent"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReviewDramaTake("usr-drama", project, old.ID, DramaTakeReview{Verdict: DramaTakeApprove, Score: 4}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReviewDramaTake("other-user", project, old.ID, DramaTakeReview{Verdict: DramaTakeApprove}); err == nil {
		t.Fatal("another user cannot review the take")
	}

	selection, err := svc.SelectDramaTake("usr-drama", project, old.ID)
	if err != nil || !selection.Changed {
		t.Fatalf("select older take: %+v %v", selection, err)
	}
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	takes = detail.Segments[1].Takes
	if !takes[1].Selected || takes[0].Selected || detail.Segments[1].VideoResourceID != old.ResourceID || !detail.Episode.FinalStale {
		t.Fatalf("older take must be in the cut and the final stale: %+v %+v", takes, detail.Episode)
	}
	if takes[0].Review == nil || takes[0].Review.Verdict != DramaTakeNewTake || takes[0].Review.Reviewer != "agent" || takes[1].Review == nil || takes[1].Review.Score != 4 {
		t.Fatalf("reviews must be listed with the takes: %+v", takes)
	}
	if again, err := svc.SelectDramaTake("usr-drama", project, old.ID); err != nil || again.Changed {
		t.Fatalf("picking the take in the cut again changes nothing: %+v %v", again, err)
	}

	runDramaTicks(t, svc, project, 6)
	if fake.byKind["video"] != videos {
		t.Fatalf("picking a take must not generate video: %d -> %d", videos, fake.byKind["video"])
	}
	if len(fake.renders) != renders+1 {
		t.Fatalf("the episode is rendered again once: %d -> %d", renders, len(fake.renders))
	}
	last := fake.renders[len(fake.renders)-1]
	var used bool
	for _, clip := range last.Clips {
		used = used || (clip.DirectMedia != nil && clip.DirectMedia.ID == old.ResourceID)
	}
	if !used {
		t.Fatalf("the new render must use the picked take: %+v", last.Clips)
	}

	svc.dramaTakeFramesHook = func(userID, resourceID string, count int) ([][]byte, error) {
		if userID != "usr-drama" || resourceID != old.ResourceID {
			t.Fatalf("frames read %s as %s", resourceID, userID)
		}
		frames := make([][]byte, count)
		for i := range frames {
			frames[i] = []byte{0xff, 0xd8, byte(i)}
		}
		return frames, nil
	}
	result, err := svc.CallMCPTool("usr-drama", mcpDramaTakeFrames, json.RawMessage(`{"projectId":"`+project+`","takeId":"`+old.ID+`","count":9}`))
	if err != nil {
		t.Fatal(err)
	}
	withImages, ok := result.(*MCPToolResult)
	if !ok || len(withImages.Images) != dramaMaxTakeFrames || withImages.Images[0].MimeType != "image/jpeg" {
		t.Fatalf("frames come back as capped jpeg images: %#v", result)
	}
}

func TestDramaTakeSelectWaitsForARunningVideo(t *testing.T) {
	svc, _ := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, _ := svc.DramaSummary("usr-drama", project)
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, summary.Episodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	segment := detail.Segments[0]
	if err := svc.repo.UpdateDramaSegmentFields(segment.ID, map[string]any{"video_status": model.DramaMediaRunning}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SelectDramaTake("usr-drama", project, segment.Takes[0].ID); err == nil {
		t.Fatal("a take cannot be picked while a new video is running")
	}
	if _, err := svc.SelectDramaTake("usr-drama", project, "missing"); err == nil {
		t.Fatal("unknown take")
	}
}
