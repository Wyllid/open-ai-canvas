package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaReviewPassesProposeFixesThatApplyOnlyWhenAccepted(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0]
	if _, err := svc.RunDramaReview("usr-drama", project, episode.ID, RunDramaReviewRequest{Passes: []string{"lighting"}}); err == nil {
		t.Fatal("unknown passes are refused")
	}
	state, err := svc.RunDramaReview("usr-drama", project, episode.ID, RunDramaReviewRequest{Passes: []string{"sound", "script", "camera"}})
	if err != nil || state.Status != model.DramaMediaQueued || len(state.Passes) != 3 || state.Passes[0] != DramaReviewPassScript {
		t.Fatalf("run review: %+v %v", state, err)
	}
	if again, err := svc.RunDramaReview("usr-drama", project, episode.ID, RunDramaReviewRequest{}); err != nil || again.RequestID != state.RequestID {
		t.Fatalf("a queued review is not requested twice: %+v %v", again, err)
	}
	videos, renders := fake.byKind["video"], fake.byKind["render"]
	runDramaTicks(t, svc, project, 4)
	if fake.byKind["review"] != 1 {
		t.Fatalf("one text call for all passes, got %d", fake.byKind["review"])
	}
	if fake.byKind["video"] != videos || fake.byKind["render"] != renders {
		t.Fatal("a review must not generate media")
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	review := detail.Review
	if review == nil || review.Status != model.DramaMediaReady || len(review.Findings) != 4 {
		t.Fatalf("want 4 findings from known passes: %+v", review)
	}
	byPass := map[string]DramaReviewFinding{}
	for _, finding := range review.Findings {
		if finding.Status != DramaFindingOpen {
			t.Fatalf("findings start open: %+v", finding)
		}
		if _, seen := byPass[finding.Pass]; !seen {
			byPass[finding.Pass] = finding
		}
	}
	script := byPass[DramaReviewPassScript]
	if script.ShotID != detail.Shots[0].ID || script.Field != "dialogue" || script.Severity != "high" {
		t.Fatalf("script finding maps to shot 1: %+v", script)
	}
	if sound := byPass[DramaReviewPassSound]; sound.ShotID != "" || sound.Field != "" || sound.Severity != "medium" {
		t.Fatalf("an episode-wide note has no shot or fix: %+v", sound)
	}
	for _, finding := range review.Findings {
		if finding.Problem == "Out of range shot keeps the note only." && (finding.ShotID != "" || finding.Field != "") {
			t.Fatalf("a shot number past the list keeps only the note: %+v", finding)
		}
	}
	if detail.Shots[0].Dialogue == script.Value {
		t.Fatal("nothing is applied before accepting")
	}

	if _, err := svc.ResolveDramaReviewFinding("usr-drama", project, episode.ID, script.ID, ResolveDramaReviewFindingRequest{Accept: true}); err != nil {
		t.Fatal(err)
	}
	camera := byPass[DramaReviewPassCamera]
	if _, err := svc.ResolveDramaReviewFinding("usr-drama", project, episode.ID, camera.ID, ResolveDramaReviewFindingRequest{Accept: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveDramaReviewFinding("other-user", project, episode.ID, camera.ID, ResolveDramaReviewFindingRequest{Accept: true}); err == nil {
		t.Fatal("another user cannot resolve findings")
	}
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Shots[0].Dialogue != script.Value || detail.Shots[1].ShotSize == camera.Value {
		t.Fatalf("only the accepted fix is applied: %+v / %+v", detail.Shots[0].Dialogue, detail.Shots[1].ShotSize)
	}
	statuses := map[string]string{}
	for _, finding := range detail.Review.Findings {
		statuses[finding.ID] = finding.Status
	}
	if statuses[script.ID] != DramaFindingAccepted || statuses[camera.ID] != DramaFindingDismissed {
		t.Fatalf("statuses: %+v", statuses)
	}
	if !detail.Episode.FinalStale {
		t.Fatal("an accepted shot edit makes the final stale like any shot edit")
	}
}

func TestParseDramaReviewFindingsRejectsNonJSON(t *testing.T) {
	if _, err := parseDramaReviewFindings("looks fine to me", nil, dramaReviewPassOrder); err == nil {
		t.Fatal("prose is not a review result")
	}
	findings, err := parseDramaReviewFindings(`{"findings":[{"pass":"camera","shot":1,"problem":"x","field":"durationSeconds","value":4.5}]}`, []model.DramaShot{{ID: "s1"}}, dramaReviewPassOrder)
	if err != nil || len(findings) != 1 || findings[0].Value != "4.5" {
		t.Fatalf("numeric values are kept as text: %+v %v", findings, err)
	}
	patch, err := dramaFindingPatch(findings[0])
	if err != nil || patch.DurationSeconds == nil || *patch.DurationSeconds != 4.5 {
		t.Fatalf("duration patch: %+v %v", patch, err)
	}
}
