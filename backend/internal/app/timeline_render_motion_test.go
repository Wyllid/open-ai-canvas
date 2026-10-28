package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func motionProjectFixture(captions *renderCaptions) renderProject {
	visible := true
	subtitle := renderClip{ID: "sub-1", Kind: "subtitle", TrackID: "subtitles", StartMs: 200, DurationMs: 1400, Text: "我今日来{退婚}", Words: []renderWord{{Text: "我", StartMs: 0, DurationMs: 300}, {Text: "今日", StartMs: 300, DurationMs: 400}, {Text: "来", StartMs: 900, DurationMs: 300}, {Text: "{退婚}", StartMs: 1200, DurationMs: 200}}}
	title := renderClip{ID: "lt-1", Kind: "text", TrackID: "titles", Graphic: renderGraphicLowerThird, StartMs: 0, DurationMs: 1500, Text: "林婉", Subtext: "苏家大小姐"}
	still := renderClipFixture("still", "image", "video", 0, 1000, "resource:img")
	still.KenBurns = "in"
	logo := renderClipFixture("logo", "image", "overlay", 500, 1000, "resource:logo")
	logo.Overlay = &renderOverlay{Position: "bottom-left", WidthPct: 20}
	return renderProject{
		Version: 2, Width: 640, Height: 360, Captions: captions,
		Tracks: []renderTrack{{ID: "video", Kind: "video", Visible: &visible}, {ID: "overlay", Kind: "image", Visible: &visible}, {ID: "titles", Kind: "text", Visible: &visible}},
		Clips:  []renderClip{still, renderClipFixture("clip", "video", "video", 1000, 1000, "resource:vid"), logo, subtitle, title, {ID: "plain-text", Kind: "text", TrackID: "titles", DurationMs: 1000, Text: "editor text"}},
	}
}

func TestRenderASSOnlyBurnsCaptionsWhenAsked(t *testing.T) {
	plan := buildRenderPlan(motionProjectFixture(nil))
	if !strings.Contains(plan.SubtitleSRT, "我今日来") {
		t.Fatalf("SRT must always be exported: %q", plan.SubtitleSRT)
	}
	if strings.Contains(plan.ASS, "Dialogue: 0,") || !strings.Contains(plan.ASS, ",Title,,0,0,0,,{\\fad(300,300)}林婉") || !strings.Contains(plan.ASS, ",Subtitle,,0,0,0,,{\\fad(300,300)}苏家大小姐") {
		t.Fatalf("without captions.burn only the titles are burned: %s", plan.ASS)
	}
	if strings.Contains(plan.ASS, "editor text") {
		t.Fatalf("plain text clips from the editor are not rendered by the server: %s", plan.ASS)
	}

	plain := buildRenderPlan(motionProjectFixture(&renderCaptions{Burn: true, Style: renderCaptionPlain}))
	if !strings.Contains(plain.ASS, "Dialogue: 0,0:00:00.20,0:00:01.60,Caption,,0,0,0,,我今日来（退婚）") {
		t.Fatalf("plain caption must be one line with braces escaped: %s", plain.ASS)
	}
	karaoke := buildRenderPlan(motionProjectFixture(&renderCaptions{Burn: true, Style: renderCaptionKaraoke}))
	if !strings.Contains(karaoke.ASS, "Karaoke,,0,0,0,,{\\kf30}我{\\kf40}今日{\\k20}{\\kf30}来{\\kf20}（退婚）") {
		t.Fatalf("karaoke caption must sweep word by word with the pause as an empty syllable: %s", karaoke.ASS)
	}
	if !strings.Contains(karaoke.ASS, "PlayResX: 640\nPlayResY: 360") {
		t.Fatalf("ASS must use the output canvas: %s", karaoke.ASS)
	}
}

func TestRenderPlanKeepsOverlayOutOfSequence(t *testing.T) {
	plan := buildRenderPlan(motionProjectFixture(nil))
	if len(plan.Segments) != 2 || plan.Segments[0].Clip.ID != "still" || plan.Segments[1].Clip.ID != "clip" {
		t.Fatalf("overlay image must not join the main sequence: %+v", plan.Segments)
	}
	if len(plan.VideoOverlays) != 1 || plan.VideoOverlays[0].Clip.ID != "logo" {
		t.Fatalf("overlay = %+v", plan.VideoOverlays)
	}
	plan.Segments[0].Source = &renderSource{Path: "src-0.png"}
	plan.Segments[1].Source = &renderSource{Path: "src-1.mp4", HasAudio: true}
	plan.VideoOverlays[0].Source = &renderSource{Path: "src-2.png"}
	joined := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	for _, want := range []string{
		"-i src-0.png -f lavfi",
		"zoompan=z='1+0.15*on/29'",
		"-loop 1 -t 1.000 -i src-2.png",
		"[4:v]scale=128:-2,format=rgba",
		"setpts=PTS-STARTPTS+0.500/TB[p0]",
		"[vseq][p0]overlay=x=25:y=main_h-overlay_h-25:eof_action=pass[vp0]",
		"[vp0]ass=filename=captions.ass[vout]",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args missing %q: %s", want, joined)
		}
	}
	if strings.Contains(joined, "-loop 1 -t 1.000 -i src-0.png") {
		t.Fatalf("a Ken Burns still must be a single frame input: %s", joined)
	}
}

func TestRenderPictureFiltersWithoutGraphicsPassThrough(t *testing.T) {
	filters := renderPictureFilters(renderPlan{}, nil, 0)
	if len(filters) != 1 || filters[0] != "[vseq]null[vout]" {
		t.Fatalf("filters = %v", filters)
	}
	if x, y := renderOverlayXY("nowhere; drop", 10); x != "main_w-overlay_w-10" || y != "10" {
		t.Fatalf("unknown position must fall back to top-right, got %s %s", x, y)
	}
}

func TestFormatASSTimestamp(t *testing.T) {
	for ms, want := range map[int64]string{0: "0:00:00.00", 1234: "0:00:01.23", 61005: "0:01:01.01", 3723456: "1:02:03.46", -5: "0:00:00.00"} {
		if got := formatASSTimestamp(ms); got != want {
			t.Fatalf("formatASSTimestamp(%d) = %s, want %s", ms, got, want)
		}
	}
}

// TestRenderMotionWithFFmpeg 用真实 ffmpeg 跑一遍图形层，确认滤镜图能被解析和执行。
func TestRenderMotionWithFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	if out, _ := exec.Command(ffmpeg, "-hide_banner", "-filters").Output(); !strings.Contains(string(out), " ass ") {
		t.Skip("ffmpeg built without libass")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(ffmpeg, args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("ffmpeg %v: %v\n%s", args, err, out)
		}
	}
	run("-nostdin", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-frames:v", "1", "still.png")
	run("-nostdin", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", "logo.png")
	run("-nostdin", "-y", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=1", "-f", "lavfi", "-i", "sine=d=1", "-shortest", "clip.mp4")
	plan := buildRenderPlan(motionProjectFixture(&renderCaptions{Burn: true, Style: renderCaptionKaraoke}))
	plan.Segments[0].Source = &renderSource{Path: "still.png"}
	plan.Segments[1].Source = &renderSource{Path: "clip.mp4", HasAudio: true}
	plan.VideoOverlays[0].Source = &renderSource{Path: "logo.png"}
	if err := os.WriteFile(filepath.Join(dir, renderASSFile), []byte(plan.ASS), 0o600); err != nil {
		t.Fatal(err)
	}
	run(buildRenderFFmpegArgs(plan, "out.mp4")...)
	if stat, err := os.Stat(filepath.Join(dir, "out.mp4")); err != nil || stat.Size() == 0 {
		t.Fatalf("no output: %v", err)
	}
}
