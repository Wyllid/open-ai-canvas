package app

import (
	"fmt"
	"sort"
	"strings"
)

// 时间线渲染：把前端 TimelineProject 快照（tracks/clips 平铺，见
// web/src/types/timeline.ts TimelineProject v2）展开为可执行的 ffmpeg 步骤。
// 与前端 timeline-to-ffmpeg.ts 保持同一数据流：trim（按 sourceStartMs 裁切）
// → 空隙补黑场静音 → concat → 图片叠加层 → ASS 字幕与标题（libass）。字幕始终另出一份 SRT，
// 只有 captions.burn 为 true 时才烧进画面；lowerThird 标题条总是烧录。
//
// 输入布局统一为「每个片段两个输入：视频源 + 音频源」，空隙展开为独立
// 黑场片段，因此第 i 个片段的视频输入为 2i、音频输入为 2i+1。

type renderClip struct {
	ID               string  `json:"id"`
	Kind             string  `json:"kind"`
	TrackID          string  `json:"trackId"`
	StartMs          int64   `json:"startMs"`
	DurationMs       int64   `json:"durationMs"`
	SourceStartMs    int64   `json:"sourceStartMs"`
	SourceDurationMs int64   `json:"sourceDurationMs"`
	Volume           float64 `json:"volume"`
	Text             string  `json:"text"`
	// FadeIn/FadeOut 是片段首尾的纯色淡入淡出（短剧黑场、闪白转场）；为 0 时是硬切。
	FadeInMs     int64  `json:"fadeInMs,omitempty"`
	FadeInColor  string `json:"fadeInColor,omitempty"`
	FadeOutMs    int64  `json:"fadeOutMs,omitempty"`
	FadeOutColor string `json:"fadeOutColor,omitempty"`
	DirectMedia  *struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	} `json:"directMedia"`
	// Words 是字幕片段的逐词时间（相对片段起点），用于卡拉 OK 逐词高亮；为空时整句同时出现。
	Words []renderWord `json:"words,omitempty"`
	// Graphic 为 lowerThird 的 text 片段烧录为标题条（人名条 / 地点条），Subtext 是第二行；
	// 其他 text 片段不由服务端渲染。
	Graphic string `json:"graphic,omitempty"`
	Subtext string `json:"subtext,omitempty"`
	// KenBurns 只对图片片段有效：in / out 推拉，left / right 横移。
	KenBurns string `json:"kenBurns,omitempty"`
	// Overlay 非空的图片片段叠加在画面上（台标、角标），不占主序列。
	Overlay *renderOverlay `json:"overlay,omitempty"`
}

type renderWord struct {
	Text       string `json:"text"`
	StartMs    int64  `json:"startMs"`
	DurationMs int64  `json:"durationMs"`
}

// renderOverlay 是图片叠加层的位置：Position 为九宫格角落或 center，WidthPct 是相对画面宽度的百分比。
type renderOverlay struct {
	Position string  `json:"position"`
	WidthPct float64 `json:"widthPct"`
}

// renderCaptions 控制字幕是否烧录与样式；SRT 不受影响，总是单独产出。
type renderCaptions struct {
	Burn  bool   `json:"burn"`
	Style string `json:"style,omitempty"`
}

const renderGraphicLowerThird = "lowerThird"

const (
	renderCaptionPlain   = "plain"
	renderCaptionKaraoke = "karaoke"
)

type renderTrack struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Visible *bool  `json:"visible"`
	Muted   bool   `json:"muted"`
	// Role 只对音频轨有效：music 轨在人声下自动压低（ducking），其余按对白/音效直接混入。
	Role string `json:"role,omitempty"`
}

const renderTrackRoleMusic = "music"

type renderProject struct {
	Version    int           `json:"version"`
	Tracks     []renderTrack `json:"tracks"`
	Clips      []renderClip  `json:"clips"`
	DurationMs int64         `json:"durationMs"`
	// Width/Height 为输出画布尺寸；缺省按 1920x1080 横屏输出。
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
	// LoudnessLUFS 非 0 时对总线做 loudnorm 响度归一（例如 -14 适合线上视频）；0 保持原响度。
	LoudnessLUFS float64 `json:"loudnessLufs,omitempty"`
	// Captions 为空时字幕只导出 SRT，不烧录。
	Captions *renderCaptions `json:"captions,omitempty"`
}

type renderSource struct {
	ResourceID string
	Clip       renderClip
	Path       string
	Ext        string
	// HasAudio 由 ffprobe 探测得到；无音轨的媒体改为静音源，避免 map 失败。
	HasAudio bool
}

// renderSegment 是渲染序列中的一段；Kind 为 video/image 表示媒体片段，
// gap 表示补黑场静音的空隙段（无 Source）。
type renderSegment struct {
	Kind       string
	DurationMs int64
	GapMs      int64
	Clip       renderClip
	Source     *renderSource
	// Music 标记来自 music 轨的音频片段，混音时会被人声压低。
	Music bool
}

type renderPlan struct {
	Segments []renderSegment
	// AudioOverlays 是音频轨上的独立片段（配音、音乐），在主序列拼接后按 startMs 混入。
	AudioOverlays []renderSegment
	// VideoOverlays 是叠加在主画面上的图片（台标、角标），按时间段显示。
	VideoOverlays []renderSegment
	SubtitleSRT   string
	// ASS 非空时写入工作目录的 renderASSFile，并在最后一步用 ass 滤镜烧录。
	ASS          string
	HasMedia     bool
	Width        int
	Height       int
	LoudnessLUFS float64
}

// buildRenderPlan 挑选可见视频/图片轨片段按 startMs 排序，并把片段之间的
// 空隙展开为黑场段，使渲染序列在时间轴上连续。
func buildRenderPlan(project renderProject) renderPlan {
	visible := map[string]bool{}
	muted := map[string]bool{}
	music := map[string]bool{}
	for _, track := range project.Tracks {
		visible[track.ID] = track.Visible == nil || *track.Visible
		muted[track.ID] = track.Muted
		music[track.ID] = track.Role == renderTrackRoleMusic
	}
	clips := make([]renderClip, 0, len(project.Clips))
	overlays := make([]renderSegment, 0)
	pictures := make([]renderSegment, 0)
	for _, clip := range project.Clips {
		if !visible[clip.TrackID] || clip.DurationMs <= 0 {
			continue
		}
		if clip.Kind == "image" && clip.Overlay != nil {
			if _, ok := mediaResourceID(clip); ok {
				pictures = append(pictures, renderSegment{Kind: "overlay", DurationMs: clip.DurationMs, Clip: clip})
			}
			continue
		}
		if clip.Kind == "audio" {
			if !muted[clip.TrackID] {
				if _, ok := mediaResourceID(clip); ok {
					overlays = append(overlays, renderSegment{Kind: "audio", DurationMs: clip.DurationMs, Clip: clip, Music: music[clip.TrackID]})
				}
			}
			continue
		}
		if clip.Kind != "video" && clip.Kind != "image" {
			continue
		}
		if muted[clip.TrackID] {
			// 静音轨的画面仍参与拼接，声音由静音源替代。
			clip.Volume = -1
		}
		clips = append(clips, clip)
	}
	sort.SliceStable(overlays, func(i, j int) bool { return overlays[i].Clip.StartMs < overlays[j].Clip.StartMs })
	sort.SliceStable(clips, func(i, j int) bool {
		if clips[i].StartMs == clips[j].StartMs {
			return clips[i].ID < clips[j].ID
		}
		return clips[i].StartMs < clips[j].StartMs
	})

	sort.SliceStable(pictures, func(i, j int) bool { return pictures[i].Clip.StartMs < pictures[j].Clip.StartMs })
	plan := renderPlan{SubtitleSRT: buildRenderSubtitleSRT(project), AudioOverlays: overlays, VideoOverlays: pictures, Width: renderWidth, Height: renderHeight}
	if project.LoudnessLUFS >= renderMinLoudnessLUFS && project.LoudnessLUFS <= renderMaxLoudnessLUFS {
		plan.LoudnessLUFS = project.LoudnessLUFS
	}
	if project.Width >= 16 && project.Height >= 16 && project.Width <= 4096 && project.Height <= 4096 {
		// libx264 yuv420p 要求偶数尺寸。
		plan.Width, plan.Height = project.Width&^1, project.Height&^1
	}
	cursor := int64(0)
	for _, clip := range clips {
		if gap := clip.StartMs - cursor; gap > 0 {
			plan.Segments = append(plan.Segments, renderSegment{Kind: "gap", DurationMs: gap, GapMs: gap})
		}
		plan.Segments = append(plan.Segments, renderSegment{Kind: clip.Kind, DurationMs: clip.DurationMs, Clip: clip})
		cursor = clip.StartMs + clip.DurationMs
	}
	width, height := plan.size()
	plan.ASS = buildRenderASS(project, visible, width, height)
	for _, seg := range plan.Segments {
		if _, ok := mediaResourceID(seg.Clip); ok {
			plan.HasMedia = true
			break
		}
	}
	return plan
}

// mediaResourceID 从片段的 directMedia.storageKey（resource:<id>）还原资源 ID。
func mediaResourceID(clip renderClip) (string, bool) {
	if clip.DirectMedia == nil {
		return "", false
	}
	key := strings.TrimSpace(clip.DirectMedia.StorageKey)
	if !strings.HasPrefix(key, "resource:") {
		return "", false
	}
	id := strings.TrimSpace(strings.TrimPrefix(key, "resource:"))
	return id, id != ""
}

func buildRenderSubtitleSRT(project renderProject) string {
	subtitle := make([]renderClip, 0, len(project.Clips))
	for _, clip := range project.Clips {
		if clip.Kind != "subtitle" || strings.TrimSpace(clip.Text) == "" || clip.DurationMs <= 0 {
			continue
		}
		subtitle = append(subtitle, clip)
	}
	sort.SliceStable(subtitle, func(i, j int) bool {
		if subtitle[i].StartMs == subtitle[j].StartMs {
			return subtitle[i].ID < subtitle[j].ID
		}
		return subtitle[i].StartMs < subtitle[j].StartMs
	})
	if len(subtitle) == 0 {
		return ""
	}
	var out strings.Builder
	for i, clip := range subtitle {
		fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n",
			i+1,
			formatSRTTimestamp(clip.StartMs),
			formatSRTTimestamp(clip.StartMs+clip.DurationMs),
			strings.TrimSpace(clip.Text))
	}
	return out.String()
}

const (
	renderWidth      = 1920
	renderHeight     = 1080
	renderFPS        = 30
	renderSampleRate = 44100
)

func (plan renderPlan) size() (int, int) {
	if plan.Width > 0 && plan.Height > 0 {
		return plan.Width, plan.Height
	}
	return renderWidth, renderHeight
}

// buildRenderFFmpegArgs 依据渲染计划生成 ffmpeg 参数（工作目录内相对路径）。
// 每段固定两个输入：视频源与音频源，末尾 concat 为单路输出；
// 音频轨片段作为额外输入在拼接后按起点延迟混入。
func buildRenderFFmpegArgs(plan renderPlan, target string) []string {
	if len(plan.Segments) == 0 {
		return nil
	}
	width, height := plan.size()
	scale := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
		width, height, width, height)
	black := fmt.Sprintf("color=c=black:s=%dx%d:r=%d", width, height, renderFPS)
	silence := fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate)
	args := []string{"-nostdin", "-y"}
	for _, seg := range plan.Segments {
		seconds := fmt.Sprintf("%.3f", float64(seg.DurationMs)/1000)
		switch {
		case seg.Kind == "gap" || seg.Source == nil:
			args = append(args, "-f", "lavfi", "-t", seconds, "-i", black, "-f", "lavfi", "-t", seconds, "-i", silence)
		case seg.Kind == "image" && renderKenBurnsMove(seg.Clip.KenBurns) != "":
			// zoompan 从单帧输出整段帧数，不能再用 -loop。
			args = append(args, "-i", seg.Source.Path, "-f", "lavfi", "-t", seconds, "-i", silence)
		case seg.Kind == "image":
			args = append(args, "-loop", "1", "-t", seconds, "-i", seg.Source.Path, "-f", "lavfi", "-t", seconds, "-i", silence)
		default:
			for range 2 {
				// 音频输入复用同一媒体文件；无音轨时改用静音源（见下方滤镜）。
				if seg.Clip.SourceStartMs > 0 {
					args = append(args, "-ss", fmt.Sprintf("%.3f", float64(seg.Clip.SourceStartMs)/1000))
				}
				args = append(args, "-t", seconds, "-i", seg.Source.Path)
			}
		}
	}
	overlayBase := len(plan.Segments) * 2
	overlays := make([]renderSegment, 0, len(plan.AudioOverlays))
	for _, overlay := range plan.AudioOverlays {
		if overlay.Source == nil {
			continue
		}
		if overlay.Clip.SourceStartMs > 0 {
			args = append(args, "-ss", fmt.Sprintf("%.3f", float64(overlay.Clip.SourceStartMs)/1000))
		}
		args = append(args, "-t", fmt.Sprintf("%.3f", float64(overlay.DurationMs)/1000), "-i", overlay.Source.Path)
		overlays = append(overlays, overlay)
	}
	pictureBase := overlayBase + len(overlays)
	pictures := make([]renderSegment, 0, len(plan.VideoOverlays))
	for _, picture := range plan.VideoOverlays {
		if picture.Source == nil {
			continue
		}
		args = append(args, "-loop", "1", "-t", fmt.Sprintf("%.3f", float64(picture.DurationMs)/1000), "-i", picture.Source.Path)
		pictures = append(pictures, picture)
	}

	filters := make([]string, 0, len(plan.Segments)*2+len(overlays)+2)
	labels := make([]string, 0, len(plan.Segments)*2)
	for i, seg := range plan.Segments {
		videoIn, audioIn := 2*i, 2*i+1
		videoLabel, audioLabel := fmt.Sprintf("v%d", i), fmt.Sprintf("a%d", i)
		duration := float64(seg.DurationMs) / 1000
		// tpad 用最后一帧补足短于片段时长的素材，trim 再裁到精确时长，保证音画时间轴对齐。
		frame := scale
		if seg.Kind == "image" && seg.Source != nil {
			if move := renderKenBurnsFilter(seg.Clip.KenBurns, width, height, seg.DurationMs); move != "" {
				frame = move
			}
		}
		filters = append(filters, fmt.Sprintf("[%d:v]fps=%d,%s,setsar=1,tpad=stop_mode=clone:stop_duration=%.3f,trim=duration=%.3f,setpts=PTS-STARTPTS%s[%s]", videoIn, renderFPS, frame, duration, duration, renderFadeFilters(seg.Clip, duration), videoLabel))
		silent := seg.Source != nil && seg.Kind != "image" && (!seg.Source.HasAudio || seg.Clip.Volume < 0)
		if silent {
			silentLabel := fmt.Sprintf("silent%d", i)
			filters = append(filters, fmt.Sprintf("%s[%s]", silence, silentLabel))
			filters = append(filters, fmt.Sprintf("[%s]atrim=0:%.3f,asetpts=N/SR/TB[%s]", silentLabel, duration, audioLabel))
		} else {
			volume := 1.0
			if seg.Clip.Volume > 0 {
				volume = seg.Clip.Volume
			}
			filters = append(filters, fmt.Sprintf("[%d:a]aformat=sample_fmts=fltp:sample_rates=%d:channel_layouts=stereo,volume=%.3f,apad,atrim=0:%.3f,asetpts=N/SR/TB%s[%s]",
				audioIn, renderSampleRate, volume, duration, renderAudioFadeFilters(seg.Clip, duration), audioLabel))
		}
		labels = append(labels, videoLabel, audioLabel)
	}
	var concatInputs strings.Builder
	for _, label := range labels {
		fmt.Fprintf(&concatInputs, "[%s]", label)
	}
	filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=1:a=1[vseq][abase]", concatInputs.String(), len(plan.Segments)))
	filters = append(filters, renderPictureFilters(plan, pictures, pictureBase)...)
	filters = append(filters, renderAudioMixFilters(plan, overlays, overlayBase)...)
	args = append(args,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[vout]", "-map", "[aout]",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
		"-t", fmt.Sprintf("%.3f", planTotalSeconds(plan)),
		target,
	)
	return args
}

// 响度归一只接受常见的成片目标区间，越界值视为未设置。
const (
	renderMinLoudnessLUFS = -24
	renderMaxLoudnessLUFS = -10
)

// renderAudioMixFilters 把拼接后的主音轨 [abase] 与音频轨片段混成 [aout]：
// 对白/音效直接叠加；音乐先合成一路，再以人声为侧链压缩（ducking），最后可选做响度归一。
// amix 一律 normalize=0，避免某一路结束后其余输入被重新放大。
func renderAudioMixFilters(plan renderPlan, overlays []renderSegment, overlayBase int) []string {
	var filters []string
	voice, music := []string{}, []string{}
	for i, overlay := range overlays {
		volume := 1.0
		if overlay.Clip.Volume > 0 {
			volume = overlay.Clip.Volume
		}
		delay := max(overlay.Clip.StartMs, 0)
		label := fmt.Sprintf("o%d", i)
		fades := renderAudioFadeFilters(overlay.Clip, float64(overlay.DurationMs)/1000)
		if fades != "" {
			// 淡入淡出按片段自身时间计算，先把时间戳归零再在 adelay 之前处理。
			fades = ",asetpts=PTS-STARTPTS" + fades
		}
		filters = append(filters, fmt.Sprintf("[%d:a]aformat=sample_fmts=fltp:sample_rates=%d:channel_layouts=stereo,volume=%.3f%s,adelay=%d|%d[%s]",
			overlayBase+i, renderSampleRate, volume, fades, delay, delay, label))
		if overlay.Music {
			music = append(music, label)
		} else {
			voice = append(voice, label)
		}
	}
	current := "abase"
	if len(voice) > 0 {
		filters = append(filters, fmt.Sprintf("[abase]%samix=inputs=%d:duration=first:dropout_transition=0:normalize=0[avoice]", renderLabels(voice), len(voice)+1))
		current = "avoice"
	}
	if len(music) > 0 {
		bed := music[0]
		if len(music) > 1 {
			filters = append(filters, fmt.Sprintf("%samix=inputs=%d:duration=longest:dropout_transition=0:normalize=0[amusic]", renderLabels(music), len(music)))
			bed = "amusic"
		}
		// 人声出现时音乐压低约 12 dB，人声停顿后约半秒内回升。
		filters = append(filters,
			fmt.Sprintf("[%s]asplit=2[amain][akey]", current),
			fmt.Sprintf("[%s][akey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[aducked]", bed),
			"[amain][aducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]",
		)
		current = "amixed"
	}
	if plan.LoudnessLUFS != 0 {
		// loudnorm 内部升采样到 192 kHz，输出前重采样回成片采样率。
		filters = append(filters, fmt.Sprintf("[%s]loudnorm=I=%.1f:TP=-1.5:LRA=11,aresample=%d[aout]", current, plan.LoudnessLUFS, renderSampleRate))
	} else {
		filters = append(filters, fmt.Sprintf("[%s]anull[aout]", current))
	}
	return filters
}

func renderLabels(labels []string) string {
	var b strings.Builder
	for _, label := range labels {
		fmt.Fprintf(&b, "[%s]", label)
	}
	return b.String()
}

func planTotalSeconds(plan renderPlan) float64 {
	var total int64
	for _, seg := range plan.Segments {
		total += seg.DurationMs
	}
	return float64(total) / 1000
}

// renderAudioFadeFilters 让片段声音随画面一起淡入淡出（时长与画面一致，最多各占一半）。
func renderAudioFadeFilters(clip renderClip, duration float64) string {
	if duration <= 0 {
		return ""
	}
	var b strings.Builder
	if clip.FadeInMs > 0 {
		fmt.Fprintf(&b, ",afade=t=in:st=0:d=%.3f", min(float64(clip.FadeInMs)/1000, duration/2))
	}
	if clip.FadeOutMs > 0 {
		fade := min(float64(clip.FadeOutMs)/1000, duration/2)
		fmt.Fprintf(&b, ",afade=t=out:st=%.3f:d=%.3f", duration-fade, fade)
	}
	return b.String()
}

// renderFadeFilters 生成片段首尾的纯色淡入淡出；颜色只接受白名单，避免拼进滤镜表达式。
func renderFadeFilters(clip renderClip, duration float64) string {
	color := func(value string) string {
		if value == "white" {
			return "white"
		}
		return "black"
	}
	var b strings.Builder
	if clip.FadeInMs > 0 {
		fmt.Fprintf(&b, ",fade=t=in:st=0:d=%.3f:color=%s", min(float64(clip.FadeInMs)/1000, duration/2), color(clip.FadeInColor))
	}
	if clip.FadeOutMs > 0 {
		fade := min(float64(clip.FadeOutMs)/1000, duration/2)
		fmt.Fprintf(&b, ",fade=t=out:st=%.3f:d=%.3f:color=%s", duration-fade, fade, color(clip.FadeOutColor))
	}
	return b.String()
}
