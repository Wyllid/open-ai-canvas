package app

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode/utf8"
)

// 时间线的图形层：图片叠加（台标、角标）、图片的 Ken Burns 推拉横移，以及用 libass 烧录的
// 字幕（含卡拉 OK 逐词高亮）和标题条。全部是本地 ffmpeg 滤镜，不调用任何模型。

// renderASSFile 是写进渲染工作目录的 ASS 字幕文件名；ffmpeg 以工作目录为当前目录运行。
const renderASSFile = "captions.ass"

// renderCaptionFont 需要覆盖中日韩字形；镜像里装的是文泉驿正黑，libass 找不到时会按 fontconfig 回退。
const renderCaptionFont = "WenQuanYi Zen Hei"

const renderOverlayFadeMs = 300

var renderOverlayPositions = []string{"top-left", "top-right", "bottom-left", "bottom-right", "center"}

// renderOverlayXY 返回叠加层的 overlay 坐标表达式；位置只接受白名单，未知值按右上角处理。
func renderOverlayXY(position string, margin int) (string, string) {
	near, farX, farY := fmt.Sprint(margin), fmt.Sprintf("main_w-overlay_w-%d", margin), fmt.Sprintf("main_h-overlay_h-%d", margin)
	switch position {
	case "top-left":
		return near, near
	case "bottom-left":
		return near, farY
	case "bottom-right":
		return farX, farY
	case "center":
		return "(main_w-overlay_w)/2", "(main_h-overlay_h)/2"
	}
	return farX, near
}

// renderPictureFilters 把图片叠加层依次压到拼接后的画面 [vseq] 上，最后按需烧录 ASS，输出 [vout]。
func renderPictureFilters(plan renderPlan, pictures []renderSegment, base int) []string {
	width, _ := plan.size()
	margin := max(width/25, 8)
	filters := []string{}
	current := "vseq"
	for i, picture := range pictures {
		overlay := picture.Clip.Overlay
		pct := overlay.WidthPct
		if pct <= 0 || pct > 100 {
			pct = 18
		}
		pictureWidth := max(int(math.Round(float64(width)*pct/100))&^1, 2)
		duration := float64(picture.DurationMs) / 1000
		fade := min(float64(renderOverlayFadeMs)/1000, duration/2)
		start := float64(max(picture.Clip.StartMs, 0)) / 1000
		label, next := fmt.Sprintf("p%d", i), fmt.Sprintf("vp%d", i)
		filters = append(filters, fmt.Sprintf("[%d:v]scale=%d:-2,format=rgba,fade=t=in:st=0:d=%.3f:alpha=1,fade=t=out:st=%.3f:d=%.3f:alpha=1,setpts=PTS-STARTPTS+%.3f/TB[%s]",
			base+i, pictureWidth, fade, duration-fade, fade, start, label))
		x, y := renderOverlayXY(overlay.Position, margin)
		filters = append(filters, fmt.Sprintf("[%s][%s]overlay=x=%s:y=%s:eof_action=pass[%s]", current, label, x, y, next))
		current = next
	}
	if plan.ASS != "" {
		filters = append(filters, fmt.Sprintf("[%s]ass=filename=%s[vout]", current, renderASSFile))
	} else {
		filters = append(filters, fmt.Sprintf("[%s]null[vout]", current))
	}
	return filters
}

func renderKenBurnsMove(move string) string {
	switch move {
	case "in", "out", "left", "right":
		return move
	}
	return ""
}

// renderKenBurnsFilter 让静止图片缓慢推拉或横移。先放大到两倍画布再 zoompan，减少抖动；
// 图片会铺满画面（裁掉多余部分），而不是像普通图片那样加黑边。
func renderKenBurnsFilter(move string, width, height int, durationMs int64) string {
	move = renderKenBurnsMove(move)
	if move == "" {
		return ""
	}
	frames := max(int(math.Round(float64(durationMs)/1000*renderFPS)), 1)
	progress := fmt.Sprintf("on/%d", max(frames-1, 1))
	zoom, x, y := "", "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"
	switch move {
	case "in":
		zoom = "1+0.15*" + progress
	case "out":
		zoom = "1.15-0.15*" + progress
	case "left":
		zoom, x = "1.12", "(iw-iw/zoom)*(1-"+progress+")"
	case "right":
		zoom, x = "1.12", "(iw-iw/zoom)*"+progress
	}
	return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,zoompan=z='%s':x='%s':y='%s':d=%d:s=%dx%d:fps=%d",
		width*2, height*2, width*2, height*2, zoom, x, y, frames, width, height, renderFPS)
}

// buildRenderASS 生成需要烧录的 ASS：captions.burn 时的字幕，以及 lowerThird 标题条。
// 没有要烧录的内容时返回空串，渲染不经过 libass。
func buildRenderASS(project renderProject, visible map[string]bool, width, height int) string {
	burn := project.Captions != nil && project.Captions.Burn
	karaoke := burn && project.Captions.Style == renderCaptionKaraoke
	clips := make([]renderClip, 0)
	for _, clip := range project.Clips {
		if clip.DurationMs <= 0 || strings.TrimSpace(clip.Text) == "" {
			continue
		}
		switch {
		case clip.Kind == "subtitle" && burn:
		case clip.Kind == "text" && clip.Graphic == renderGraphicLowerThird && (visible[clip.TrackID] || clip.TrackID == ""):
		default:
			continue
		}
		clips = append(clips, clip)
	}
	if len(clips) == 0 {
		return ""
	}
	sort.SliceStable(clips, func(i, j int) bool { return clips[i].StartMs < clips[j].StartMs })
	short := min(width, height)
	captionSize := max(short*5/100, 12)
	titleSize, subSize := max(short*45/1000, 12), max(short*32/1000, 10)
	margin := max(width*6/100, 8)
	captionMargin := height * 9 / 100
	if height > width {
		// 竖屏底部常被平台按钮与文案遮住，字幕再抬高一些。
		captionMargin = height * 16 / 100
	}
	titleMargin := captionMargin + captionSize*3
	var b strings.Builder
	fmt.Fprintf(&b, "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n", width, height)
	b.WriteString("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	outline := max(captionSize/14, 2)
	// 卡拉 OK：SecondaryColour 是未唱到的白字，PrimaryColour 是唱到后的高亮黄。
	fmt.Fprintf(&b, "Style: Caption,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,%d,1,2,%d,%d,%d,1\n", renderCaptionFont, captionSize, outline, margin, margin, captionMargin)
	fmt.Fprintf(&b, "Style: Karaoke,%s,%d,&H0000D7FF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,%d,1,2,%d,%d,%d,1\n", renderCaptionFont, captionSize, outline, margin, margin, captionMargin)
	fmt.Fprintf(&b, "Style: Title,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,3,%d,0,1,%d,%d,%d,1\n", renderCaptionFont, titleSize, max(titleSize/4, 4), margin, margin, titleMargin)
	fmt.Fprintf(&b, "Style: Subtitle,%s,%d,&H00E6E6E6,&H00E6E6E6,&H00000000,&H99000000,0,0,0,0,100,100,0,0,3,%d,0,1,%d,%d,%d,1\n\n", renderCaptionFont, subSize, max(subSize/4, 3), margin, margin, titleMargin-titleSize-subSize/2)
	b.WriteString("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, clip := range clips {
		start, end := clip.StartMs, clip.StartMs+clip.DurationMs
		if clip.Kind == "text" {
			fade := fmt.Sprintf("{\\fad(%d,%d)}", renderOverlayFadeMs, renderOverlayFadeMs)
			fmt.Fprintf(&b, "Dialogue: 1,%s,%s,Title,,0,0,0,,%s%s\n", formatASSTimestamp(start), formatASSTimestamp(end), fade, escapeASSText(clip.Text))
			if sub := strings.TrimSpace(clip.Subtext); sub != "" {
				fmt.Fprintf(&b, "Dialogue: 1,%s,%s,Subtitle,,0,0,0,,%s%s\n", formatASSTimestamp(start), formatASSTimestamp(end), fade, escapeASSText(sub))
			}
			continue
		}
		if karaoke && len(clip.Words) > 0 {
			fmt.Fprintf(&b, "Dialogue: 0,%s,%s,Karaoke,,0,0,0,,%s\n", formatASSTimestamp(start), formatASSTimestamp(end), renderKaraokeText(clip.Words, clip.DurationMs))
			continue
		}
		fmt.Fprintf(&b, "Dialogue: 0,%s,%s,Caption,,0,0,0,,%s\n", formatASSTimestamp(start), formatASSTimestamp(end), escapeASSText(clip.Text))
	}
	return b.String()
}

// renderKaraokeText 用 \kf 逐词扫色；词与词之间的停顿写成空音节，保证高亮和声音对齐。
func renderKaraokeText(words []renderWord, durationMs int64) string {
	var b strings.Builder
	cursor := int64(0)
	for _, word := range words {
		if word.StartMs > cursor {
			fmt.Fprintf(&b, "{\\k%d}", (word.StartMs-cursor+5)/10)
		}
		length := max(min(word.DurationMs, durationMs-max(word.StartMs, cursor)), 0)
		fmt.Fprintf(&b, "{\\kf%d}%s", (length+5)/10, escapeASSText(word.Text))
		cursor = max(word.StartMs, cursor) + length
	}
	return b.String()
}

// escapeASSText 去掉会被 libass 当作样式指令的字符，换行转为 \N。
func escapeASSText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.NewReplacer("\\", "＼", "{", "（", "}", "）", "\r\n", "\\N", "\n", "\\N", "\r", "").Replace(text)
	if utf8.RuneCountInString(text) > 400 {
		text = string([]rune(text)[:400])
	}
	return text
}

// formatASSTimestamp 输出 ASS 时间 H:MM:SS.cc（百分之一秒）。
func formatASSTimestamp(ms int64) string {
	ms = max(ms, 0)
	cs := (ms + 5) / 10
	return fmt.Sprintf("%d:%02d:%02d.%02d", cs/360000, cs/6000%60, cs/100%60, cs%100)
}
