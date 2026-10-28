package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

func continuityShots() []model.DramaShot {
	return []model.DramaShot{
		{Position: 0, SegmentIndex: 0, Scene: "Kitchen"},
		{Position: 1, SegmentIndex: 0, Scene: "Kitchen"},
		{Position: 2, SegmentIndex: 1, Scene: "Kitchen"},
		{Position: 3, SegmentIndex: 2, Scene: "Street"},
		{Position: 4, SegmentIndex: 3, Scene: "Street", Transition: production.TransitionBlack},
	}
}

func TestDramaSegmentContinuityReanchorsOnSceneChangeAndFades(t *testing.T) {
	settings := DramaSettings{}
	shots := continuityShots()
	want := []string{dramaContinuityReanchor, dramaContinuityContinuous, dramaContinuityReanchor, dramaContinuityReanchor}
	for index, expected := range want {
		if got := dramaSegmentContinuity(settings, shots, index); got != expected {
			t.Errorf("segment %d continuity = %s, want %s", index, got, expected)
		}
	}

	settings.Storyboard.Continuity = production.ContinuityChain
	for index := 1; index < len(want); index++ {
		if got := dramaSegmentContinuity(settings, shots, index); got != dramaContinuityContinuous {
			t.Errorf("chain mode segment %d = %s, want continuous", index, got)
		}
	}
}

func TestDramaSameScenePrefersSceneCastID(t *testing.T) {
	if !dramaSameScene(model.DramaShot{SceneCastID: "s1", Scene: "A"}, model.DramaShot{SceneCastID: "s1", Scene: "B"}) {
		t.Fatal("same scene cast must match even when the text differs")
	}
	if dramaSameScene(model.DramaShot{SceneCastID: "s1"}, model.DramaShot{SceneCastID: "s2"}) {
		t.Fatal("different scene casts must not match")
	}
	if !dramaSameScene(model.DramaShot{Scene: "A"}, model.DramaShot{}) {
		t.Fatal("a missing scene keeps the chain")
	}
}

func TestDramaChainedPreviousOnlyForContinuousBoundaries(t *testing.T) {
	segments := []model.DramaSegment{{ID: "a", SegmentIndex: 0}, {ID: "b", SegmentIndex: 1}, {ID: "c", SegmentIndex: 2}}
	shots := continuityShots()
	if got := dramaChainedPrevious(DramaSettings{}, shots, segments, 1); got == nil || got.ID != "a" {
		t.Fatalf("segment 1 should chain from a, got %+v", got)
	}
	if got := dramaChainedPrevious(DramaSettings{}, shots, segments, 2); got != nil {
		t.Fatalf("segment 2 changes scene and must not chain, got %+v", got)
	}
	if got := dramaChainedPrevious(DramaSettings{}, shots, segments, 0); got != nil {
		t.Fatal("the first segment never chains")
	}
}

func TestDramaTimelineFadesAtSegmentBoundaries(t *testing.T) {
	segments := []model.DramaSegment{
		{ID: "a", SegmentIndex: 0, VideoStatus: "ready", VideoResourceID: "va", VideoSeconds: 5},
		{ID: "b", SegmentIndex: 1, VideoStatus: "ready", VideoResourceID: "vb", VideoSeconds: 5},
		{ID: "c", SegmentIndex: 2, VideoStatus: "ready", VideoResourceID: "vc", VideoSeconds: 5},
	}
	shots := []model.DramaShot{
		{Position: 0, SegmentIndex: 0},
		{Position: 1, SegmentIndex: 1, Transition: production.TransitionBlack},
		{Position: 2, SegmentIndex: 2, Transition: production.TransitionWhite},
	}
	settings := DramaSettings{}
	settings.Storyboard.TransitionMs = 600
	timeline, err := buildDramaTimeline(settings, segments, shots)
	if err != nil {
		t.Fatal(err)
	}
	a, b, c := timeline.Clips[0], timeline.Clips[1], timeline.Clips[2]
	if a.FadeInMs != 0 || a.FadeOutMs != 300 || a.FadeOutColor != "black" {
		t.Fatalf("clip a = %+v", a)
	}
	if b.FadeInMs != 300 || b.FadeInColor != "black" || b.FadeOutMs != 200 || b.FadeOutColor != "white" {
		t.Fatalf("clip b = %+v", b)
	}
	if c.FadeInMs != 400 || c.FadeInColor != "white" || c.FadeOutMs != 0 {
		t.Fatalf("clip c = %+v", c)
	}

	settings.Storyboard.Transition = production.TransitionCut
	timeline, err = buildDramaTimeline(settings, segments, shots)
	if err != nil {
		t.Fatal(err)
	}
	for _, clip := range timeline.Clips {
		if clip.FadeInMs != 0 || clip.FadeOutMs != 0 {
			t.Fatalf("a project-wide cut must override shot fades: %+v", clip)
		}
	}
}
