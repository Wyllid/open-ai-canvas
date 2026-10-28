package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

func TestDramaSegmentStartFrameReplacesTheChain(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0]
	audio := fake.resource("usr-drama", "media", "audio/mpeg")
	if err := svc.UpdateDramaSegment("usr-drama", project, episode.ID, 1, UpdateDramaSegmentRequest{StartFrameResourceID: &audio}); err == nil {
		t.Fatal("an audio resource must be refused as a start frame")
	}
	previs := fake.resource("usr-drama", "image", "image/png")
	if err := svc.UpdateDramaSegment("usr-drama", project, episode.ID, 1, UpdateDramaSegmentRequest{StartFrameResourceID: &previs}); err != nil {
		t.Fatal(err)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	segment := detail.Segments[1]
	if segment.StartFrameResourceID != previs || segment.VideoStatus == model.DramaMediaReady {
		t.Fatalf("a new start frame makes the segment video stale: %+v", segment)
	}
	request := segment.Request
	if request.Continuity != dramaContinuityStartFrame || request.Operation != "image_to_video" || request.FirstFrameResourceID != previs || request.FirstFramePending {
		t.Fatalf("the start frame replaces the previous segment's last frame: %+v", request)
	}
	if request.ReferenceCapacity != 5 {
		t.Fatalf("the start frame takes one image slot: %+v", request)
	}

	rows, err := svc.repo.DramaSegments(episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	var settings DramaSettings
	settings.Storyboard.Continuity = production.ContinuityChain
	if previous := dramaChainedPrevious(settings, detail.Shots, rows, 1); previous != nil {
		t.Fatalf("a segment with a start frame must not wait for the previous video: %+v", previous)
	}

	empty := ""
	if err := svc.UpdateDramaSegment("usr-drama", project, episode.ID, 1, UpdateDramaSegmentRequest{StartFrameResourceID: &empty}); err != nil {
		t.Fatal(err)
	}
	detail, _ = svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if detail.Segments[1].StartFrameResourceID != "" || detail.Segments[1].Request.Continuity != dramaContinuityContinuous {
		t.Fatalf("clearing the start frame goes back to the chain: %+v", detail.Segments[1].Request)
	}
}

func TestDramaFinalEnhanceNeedsConfirmationAndKeepsTheFinal(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0]
	if episode.FinalResourceID == "" {
		t.Fatalf("episode must be rendered first: %+v", episode)
	}
	choice := DramaModelChoice{ChannelID: "ch", ModelKey: "enhance"}
	if _, err := svc.EnhanceDramaFinal("usr-drama", project, episode.ID, DramaEnhanceRequest{Model: choice, Resolution: "2k"}); err == nil {
		t.Fatal("an upscale without confirm must be refused")
	}
	if _, err := svc.EnhanceDramaFinal("usr-drama", project, episode.ID, DramaEnhanceRequest{Resolution: "2k", Confirm: true}); err == nil {
		t.Fatal("an upscale needs a model")
	}
	videos := fake.byKind["video"]
	state, err := svc.EnhanceDramaFinal("usr-drama", project, episode.ID, DramaEnhanceRequest{Model: choice, Resolution: "2k", Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	if fake.byKind["video"] != videos+1 || state.SourceResourceID != episode.FinalResourceID {
		t.Fatalf("one enhance task on the current final: %+v", state)
	}
	req := fake.requests[len(fake.requests)-1]
	sources, _ := req.Input["referenceVideos"].([]any)
	metadata, _ := req.Input["metadata"].(map[string]any)
	if req.Type != "canvas_video" || req.Operation != VideoProcessingOperationEnhance || len(sources) != 1 || sources[0].(map[string]any)["storageKey"] != "resource:"+episode.FinalResourceID || metadata["videoEditOperation"] != VideoProcessingOperationEnhance {
		t.Fatalf("enhance request: %+v", req)
	}
	if images, _ := req.Input["referenceImages"].([]any); len(images) != 0 {
		t.Fatalf("video processing must not send images: %+v", images)
	}

	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Enhance == nil || detail.Enhance.Status != string(model.TaskStatusSucceeded) || detail.Enhance.ResourceID == "" || detail.Enhance.Outdated {
		t.Fatalf("the finished task's video is kept next to the final: %+v", detail.Enhance)
	}
	if detail.Episode.FinalResourceID != episode.FinalResourceID || detail.Episode.FinalStale {
		t.Fatalf("upscaling must not replace or invalidate the final: %+v", detail.Episode)
	}

	burn := true
	if _, err := svc.SetDramaCaptions("usr-drama", project, episode.ID, SetDramaCaptionsRequest{Burn: &burn}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnhanceDramaFinal("usr-drama", project, episode.ID, DramaEnhanceRequest{Model: choice, Resolution: "2k", Confirm: true}); err == nil {
		t.Fatal("a stale final must not be upscaled")
	}
	runDramaTicks(t, svc, project, 6)
	detail, _ = svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if detail.Enhance == nil || !detail.Enhance.Outdated {
		t.Fatalf("an upscale of an older final is marked outdated: %+v", detail.Enhance)
	}
}
