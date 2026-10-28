package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaMusicCuesRenderOnADuckedMusicTrack(t *testing.T) {
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
	if fake.renders[0].LoudnessLUFS != dramaLoudnessLUFS {
		t.Fatalf("drama renders are loudness-normalized: %+v", fake.renders[0].LoudnessLUFS)
	}
	video := fake.resource("usr-drama", "video", "video/mp4")
	if _, err := svc.SetDramaMusic("usr-drama", project, episode.ID, SetDramaMusicRequest{Cues: []DramaMusicCue{{ResourceID: video, StartMs: 0, DurationMs: 2000}}}); err == nil {
		t.Fatal("a video resource must be refused as music")
	}
	if _, err := svc.SetDramaMusic("usr-drama", project, episode.ID, SetDramaMusicRequest{Cues: []DramaMusicCue{{ResourceID: "res-missing", StartMs: 0, DurationMs: 2000}}}); err == nil {
		t.Fatal("an unknown resource must be refused")
	}
	audio := fake.resource("usr-drama", "media", "audio/mpeg")
	if _, err := svc.SetDramaMusic("usr-drama", project, episode.ID, SetDramaMusicRequest{Cues: []DramaMusicCue{{ResourceID: audio, StartMs: -1, DurationMs: 2000}}}); err == nil {
		t.Fatal("a negative start must be refused")
	}
	cues, err := svc.SetDramaMusic("usr-drama", project, episode.ID, SetDramaMusicRequest{Cues: []DramaMusicCue{
		{Label: " M1 ", ResourceID: audio, StartMs: 0, DurationMs: 4000},
		{Label: "M2", ResourceID: audio, StartMs: 8000, DurationMs: 60000, Volume: 0.6},
		{Label: "late", ResourceID: audio, StartMs: 999000, DurationMs: 1000},
	}})
	if err != nil || len(cues) != 3 || cues[0].Label != "M1" {
		t.Fatalf("set music: %+v %v", cues, err)
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode.ID)
	if err != nil || len(detail.MusicCues) != 3 || !detail.Episode.FinalStale {
		t.Fatalf("detail must list cues and mark the final stale: %+v %v", detail.Episode, err)
	}
	renders, videos := len(fake.renders), fake.byKind["video"]
	runDramaTicks(t, svc, project, 6)
	if fake.byKind["video"] != videos {
		t.Fatalf("changing music must not generate new videos: %d -> %d", videos, fake.byKind["video"])
	}
	if len(fake.renders) != renders+1 {
		t.Fatalf("a stale final must be rendered again once: %d -> %d", renders, len(fake.renders))
	}
	timeline := fake.renders[len(fake.renders)-1]
	var musicTrack bool
	for _, track := range timeline.Tracks {
		musicTrack = musicTrack || (track.ID == "music" && track.Role == renderTrackRoleMusic)
	}
	var music []renderClip
	for _, clip := range timeline.Clips {
		if clip.TrackID == "music" {
			music = append(music, clip)
		}
	}
	if !musicTrack || len(music) != 2 {
		t.Fatalf("want a music track with the two cues inside the episode: %+v", timeline)
	}
	if music[0].Volume != dramaMusicVolume || music[1].Volume != 0.6 || music[1].StartMs+music[1].DurationMs != timeline.DurationMs {
		t.Fatalf("cue volume and trimming: %+v (total %d)", music, timeline.DurationMs)
	}
	if music[0].FadeInMs != dramaMusicFadeInMs || music[0].FadeOutMs != dramaMusicFadeOutMs {
		t.Fatalf("music cues fade in and out instead of starting and stopping hard: %+v", music[0])
	}
	if _, err := svc.SetDramaMusic("usr-drama", project, episode.ID, SetDramaMusicRequest{}); err != nil {
		t.Fatal(err)
	}
	if detail, _ := svc.DramaEpisodeDetail("usr-drama", project, episode.ID); len(detail.MusicCues) != 0 {
		t.Fatalf("an empty list clears the music: %+v", detail.MusicCues)
	}
	resources, err := svc.DramaAudioResources("usr-drama", 10)
	if err != nil || len(resources) != 1 || resources[0].ID != audio {
		t.Fatalf("audio resources: %+v %v", resources, err)
	}
}

func TestRenderMixDucksMusicUnderVoiceAndNormalizes(t *testing.T) {
	plan := buildRenderPlan(renderProject{Version: 2, LoudnessLUFS: -14,
		Tracks: []renderTrack{{ID: "v", Kind: "video"}, {ID: "m", Kind: "audio", Role: renderTrackRoleMusic}, {ID: "fx", Kind: "audio"}},
		Clips: []renderClip{
			renderClipFixture("a", "video", "v", 0, 4000, "resource:v"),
			renderClipFixture("m1", "audio", "m", 500, 3000, "resource:m"),
			renderClipFixture("m2", "audio", "m", 2000, 2000, "resource:m"),
			renderClipFixture("f", "audio", "fx", 1000, 1000, "resource:fx"),
		}})
	plan.Segments[0].Source = &renderSource{Path: "v.mp4", HasAudio: true}
	for i := range plan.AudioOverlays {
		plan.AudioOverlays[i].Source = &renderSource{Path: "a.m4a"}
	}
	joined := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	for _, want := range []string{
		"[abase][o1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[avoice]",
		"[o0][o2]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[amusic]",
		"[avoice]asplit=2[amain][akey]",
		"[amusic][akey]sidechaincompress=",
		"[amixed]loudnorm=I=-14.0:TP=-1.5:LRA=11,aresample=44100[aout]",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("mix missing %q: %s", want, joined)
		}
	}

	plain := buildRenderPlan(renderProject{Version: 2, LoudnessLUFS: -40, Tracks: []renderTrack{{ID: "v", Kind: "video"}}, Clips: []renderClip{renderClipFixture("a", "video", "v", 0, 1000, "resource:v")}})
	plain.Segments[0].Source = &renderSource{Path: "v.mp4", HasAudio: true}
	joined = strings.Join(buildRenderFFmpegArgs(plain, "out.mp4"), " ")
	if strings.Contains(joined, "loudnorm") || strings.Contains(joined, "sidechaincompress") || !strings.Contains(joined, "[abase]anull[aout]") {
		t.Fatalf("a plain timeline keeps its loudness and has no ducking: %s", joined)
	}
}

func TestRenderFadesCarryToTheAudio(t *testing.T) {
	video := renderClipFixture("a", "video", "v", 0, 4000, "resource:v")
	video.FadeOutMs, video.FadeOutColor = 600, "black"
	music := renderClipFixture("m1", "audio", "m", 500, 2000, "resource:m")
	music.FadeInMs, music.FadeOutMs = 250, 5000
	plan := buildRenderPlan(renderProject{Version: 2,
		Tracks: []renderTrack{{ID: "v", Kind: "video"}, {ID: "m", Kind: "audio", Role: renderTrackRoleMusic}},
		Clips:  []renderClip{video, music}})
	plan.Segments[0].Source = &renderSource{Path: "v.mp4", HasAudio: true}
	for i := range plan.AudioOverlays {
		plan.AudioOverlays[i].Source = &renderSource{Path: "a.m4a"}
	}
	joined := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	for _, want := range []string{
		"fade=t=out:st=3.400:d=0.600:color=black",
		"asetpts=N/SR/TB,afade=t=out:st=3.400:d=0.600[a0]",
		"asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.250,afade=t=out:st=1.000:d=1.000,adelay=500|500[o0]",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q: %s", want, joined)
		}
	}
}
