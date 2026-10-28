package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// 短剧字幕：默认按镜头台词与剧情段视频时长自动排时间，逐字时间按字数估算（视频模型同步生成
// 对白，没有可用的词级时间戳）。用户或代理可以整体改写字幕（含逐词时间，例如来自外部 ASR），
// 改写后的字幕不再随剧本自动更新，直到恢复自动。SRT 总是随成片导出；只有 burn 为 true 时才烧进画面。

// DramaCaptionWord 是一个字幕词的时间，相对所在字幕条的起点。
type DramaCaptionWord struct {
	Text       string `json:"text"`
	StartMs    int64  `json:"startMs"`
	DurationMs int64  `json:"durationMs"`
}

// DramaCaptionCue 是一条字幕；StartMs 是集内时间。ShotID 指向产生这条台词的镜头，手工新增的字幕可为空。
type DramaCaptionCue struct {
	ShotID     string             `json:"shotId,omitempty"`
	StartMs    int64              `json:"startMs"`
	DurationMs int64              `json:"durationMs"`
	Text       string             `json:"text"`
	Words      []DramaCaptionWord `json:"words"`
}

// dramaCaptionSettings 存在 DramaEpisode.CaptionsJSON；Cues 为 nil 表示自动字幕。
type dramaCaptionSettings struct {
	Burn  bool              `json:"burn"`
	Style string            `json:"style,omitempty"`
	Cues  []DramaCaptionCue `json:"cues,omitempty"`
}

// DramaCaptions 是一集字幕的完整视图。
type DramaCaptions struct {
	Burn  bool   `json:"burn"`
	Style string `json:"style"`
	// Edited 为 true 表示字幕已被改写，不再随剧本自动更新。
	Edited bool `json:"edited"`
	// EstimatedTiming 表示逐词时间是按字数估算的，并非对音频的识别结果。
	EstimatedTiming bool `json:"estimatedTiming"`
	// Outdated 列出改写后的字幕里已不存在的镜头，提示剧本改过、字幕可能需要恢复自动。
	Outdated []string          `json:"outdated,omitempty"`
	Cues     []DramaCaptionCue `json:"cues"`
	SRT      string            `json:"srt"`
}

// SetDramaCaptionsRequest 修改字幕设置；Cues 为 nil 时保留现有字幕，Reset 为 true 时恢复自动字幕。
type SetDramaCaptionsRequest struct {
	Burn  *bool             `json:"burn"`
	Style string            `json:"style"`
	Cues  []DramaCaptionCue `json:"cues"`
	Reset bool              `json:"reset"`
}

const (
	dramaMaxCaptionCues  = 400
	dramaMaxCaptionRunes = 120
	// dramaCaptionMinMs 是一条字幕最短的显示时间。
	dramaCaptionMinMs = 600
	// dramaCaptionLineRunes 超过这个长度的台词按标点拆成多条，适合竖屏一行显示。
	dramaCaptionLineRunes = 16
)

func decodeDramaCaptionSettings(raw string) dramaCaptionSettings {
	var settings dramaCaptionSettings
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &settings)
	}
	if settings.Style != renderCaptionKaraoke {
		settings.Style = renderCaptionPlain
	}
	return settings
}

// dramaCaptionsView 计算一集当前生效的字幕。
func dramaCaptionsView(episode *model.DramaEpisode, segments []model.DramaSegment, shots []model.DramaShot) DramaCaptions {
	settings := decodeDramaCaptionSettings(episode.CaptionsJSON)
	view := DramaCaptions{Burn: settings.Burn, Style: settings.Style, Edited: settings.Cues != nil, Cues: settings.Cues}
	if settings.Cues == nil {
		view.Cues, view.EstimatedTiming = autoDramaCaptions(segments, shots), true
	} else {
		known := map[string]bool{}
		for _, shot := range shots {
			known[shot.ID] = true
		}
		for _, cue := range settings.Cues {
			if cue.ShotID != "" && !known[cue.ShotID] && !containsString(view.Outdated, cue.ShotID) {
				view.Outdated = append(view.Outdated, cue.ShotID)
			}
		}
	}
	view.SRT = buildRenderSubtitleSRT(renderProject{Clips: dramaCaptionClips(view.Cues)})
	return view
}

// autoDramaCaptions 把每个镜头的台词放到它在成片里的位置：段内各镜头按计划时长等比缩放到
// 段视频的实际秒数，句首稍留空，长台词按标点拆成多条。
func autoDramaCaptions(segments []model.DramaSegment, shots []model.DramaShot) []DramaCaptionCue {
	ordered := append([]model.DramaSegment(nil), segments...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].SegmentIndex < ordered[j].SegmentIndex })
	bySegment := map[int][]model.DramaShot{}
	for _, shot := range shots {
		bySegment[shot.SegmentIndex] = append(bySegment[shot.SegmentIndex], shot)
	}
	cues := []DramaCaptionCue{}
	cursor := int64(0)
	for _, segment := range ordered {
		group := bySegment[segment.SegmentIndex]
		sort.SliceStable(group, func(i, j int) bool { return group[i].Position < group[j].Position })
		var planned int64
		for _, shot := range group {
			planned += max(shot.DurationMs, 0)
		}
		actual := int64(segment.VideoSeconds) * 1000
		if actual <= 0 {
			actual = planned
		}
		offset := int64(0)
		for _, shot := range group {
			length := max(shot.DurationMs, 0)
			if planned > 0 {
				length = length * actual / planned
			}
			start := cursor + offset
			offset += length
			text := cleanDramaCaptionText(shot.Dialogue)
			if text == "" || length < dramaCaptionMinMs {
				continue
			}
			// 台词通常在镜头开始后一小会儿才出口，结尾前先收字幕，避免跨到下一个镜头。
			lead, tail := min(length/10, 250), min(length/12, 150)
			cues = append(cues, splitDramaCaption(shot.ID, text, start+lead, length-lead-tail)...)
		}
		cursor += actual
	}
	return cues
}

// cleanDramaCaptionText 去掉台词里的舞台说明（括号内容）和多余空白。
func cleanDramaCaptionText(text string) string {
	var b strings.Builder
	depth := 0
	for _, r := range text {
		switch r {
		case '(', '（', '[', '【':
			depth++
			continue
		case ')', '）', ']', '】':
			if depth > 0 {
				depth--
			}
			continue
		}
		if depth == 0 {
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// splitDramaCaption 按句读把长台词拆成几条，时间按字数分配。
func splitDramaCaption(shotID, text string, startMs, durationMs int64) []DramaCaptionCue {
	parts := []string{}
	var current []rune
	flush := func() {
		if part := strings.TrimSpace(string(current)); part != "" {
			parts = append(parts, part)
		}
		current = current[:0]
	}
	for _, r := range text {
		current = append(current, r)
		if strings.ContainsRune("。！？!?；;…", r) || (strings.ContainsRune("，,、", r) && len(current) >= dramaCaptionLineRunes/2) || len(current) >= dramaCaptionLineRunes*2 {
			flush()
		}
	}
	flush()
	// 太碎的片段并回前一条，避免一闪而过。
	merged := []string{}
	for _, part := range parts {
		if n := len(merged); n > 0 && utf8.RuneCountInString(merged[n-1])+utf8.RuneCountInString(part) <= dramaCaptionLineRunes {
			merged[n-1] += part
			continue
		}
		merged = append(merged, part)
	}
	var total int64
	for _, part := range merged {
		total += dramaCaptionWeight(part)
	}
	cues := make([]DramaCaptionCue, 0, len(merged))
	cursor := startMs
	for i, part := range merged {
		length := durationMs * dramaCaptionWeight(part) / max(total, 1)
		if i == len(merged)-1 {
			length = startMs + durationMs - cursor
		}
		cues = append(cues, DramaCaptionCue{ShotID: shotID, StartMs: cursor, DurationMs: length, Text: part, Words: estimateDramaCaptionWords(part, length)})
		cursor += length
	}
	return cues
}

// dramaCaptionTokens 把一句字幕切成词：汉字、假名、谚文逐字，拉丁文按单词，标点附在前一个词后。
func dramaCaptionTokens(text string) []string {
	tokens := []string{}
	var word []rune
	flushWord := func() {
		if len(word) > 0 {
			tokens = append(tokens, string(word))
			word = word[:0]
		}
	}
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul):
			flushWord()
			tokens = append(tokens, string(r))
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '\'' || r == '’':
			word = append(word, r)
		case unicode.IsSpace(r):
			flushWord()
			if n := len(tokens); n > 0 && !strings.HasSuffix(tokens[n-1], " ") {
				tokens[n-1] += " "
			}
		default:
			flushWord()
			if n := len(tokens); n > 0 {
				tokens[n-1] += string(r)
			} else {
				tokens = append(tokens, string(r))
			}
		}
	}
	flushWord()
	return tokens
}

func dramaCaptionWeight(text string) int64 {
	var weight int64
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			weight++
		}
	}
	return max(weight, 1)
}

// estimateDramaCaptionWords 按每个词的字数把字幕时长分给各词，用于卡拉 OK 高亮。
func estimateDramaCaptionWords(text string, durationMs int64) []DramaCaptionWord {
	tokens := dramaCaptionTokens(text)
	var total int64
	for _, token := range tokens {
		total += dramaCaptionWeight(token)
	}
	words := make([]DramaCaptionWord, 0, len(tokens))
	cursor := int64(0)
	for i, token := range tokens {
		length := durationMs * dramaCaptionWeight(token) / max(total, 1)
		if i == len(tokens)-1 {
			length = durationMs - cursor
		}
		words = append(words, DramaCaptionWord{Text: token, StartMs: cursor, DurationMs: max(length, 0)})
		cursor += length
	}
	return words
}

// dramaCaptionClips 把字幕放到时间线的 subtitle 轨上。
func dramaCaptionClips(cues []DramaCaptionCue) []renderClip {
	clips := make([]renderClip, 0, len(cues))
	for i, cue := range cues {
		words := make([]renderWord, 0, len(cue.Words))
		for _, word := range cue.Words {
			words = append(words, renderWord(word))
		}
		clips = append(clips, renderClip{ID: fmt.Sprintf("caption-%03d", i), Kind: "subtitle", TrackID: "captions", StartMs: cue.StartMs, DurationMs: cue.DurationMs, Text: cue.Text, Words: words})
	}
	return clips
}

// withDramaCaptions 为成片加字幕轨：总是导出 SRT，按设置决定是否烧录与样式。
func withDramaCaptions(timeline renderProject, episode *model.DramaEpisode, segments []model.DramaSegment, shots []model.DramaShot) renderProject {
	view := dramaCaptionsView(episode, segments, shots)
	if len(view.Cues) == 0 {
		return timeline
	}
	visible := true
	timeline.Tracks = append(timeline.Tracks, renderTrack{ID: "captions", Kind: "subtitle", Visible: &visible})
	for _, clip := range dramaCaptionClips(view.Cues) {
		if clip.StartMs >= timeline.DurationMs {
			continue
		}
		clip.DurationMs = min(clip.DurationMs, timeline.DurationMs-clip.StartMs)
		timeline.Clips = append(timeline.Clips, clip)
	}
	timeline.Captions = &renderCaptions{Burn: view.Burn, Style: view.Style}
	return timeline
}

// DramaCaptions 返回一集当前生效的字幕与 SRT。
func (s *Service) DramaCaptions(userID, projectID, episodeID string) (DramaCaptions, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaCaptions{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return DramaCaptions{}, err
	}
	segments, shots, err := s.dramaEpisodeParts(episode.ID)
	if err != nil {
		return DramaCaptions{}, err
	}
	return dramaCaptionsView(episode, segments, shots), nil
}

func (s *Service) dramaEpisodeParts(episodeID string) ([]model.DramaSegment, []model.DramaShot, error) {
	segments, err := s.repo.DramaSegments(episodeID)
	if err != nil {
		return nil, nil, err
	}
	shots, err := s.repo.DramaShots(episodeID)
	return segments, shots, err
}

// SetDramaCaptions 修改字幕设置或整体改写字幕。已有成片时标记为过期，由调度循环重新合成（只跑本地 ffmpeg）。
func (s *Service) SetDramaCaptions(userID, projectID, episodeID string, req SetDramaCaptionsRequest) (DramaCaptions, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return DramaCaptions{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return DramaCaptions{}, err
	}
	settings := decodeDramaCaptionSettings(episode.CaptionsJSON)
	if req.Burn != nil {
		settings.Burn = *req.Burn
	}
	switch req.Style {
	case "":
	case renderCaptionPlain, renderCaptionKaraoke:
		settings.Style = req.Style
	default:
		return DramaCaptions{}, BadAuthRequest("style must be plain or karaoke")
	}
	if req.Reset && req.Cues != nil {
		return DramaCaptions{}, BadAuthRequest("send either reset or cues, not both")
	}
	if req.Reset {
		settings.Cues = nil
	}
	if req.Cues != nil {
		cues, err := normalizeDramaCaptionCues(req.Cues)
		if err != nil {
			return DramaCaptions{}, err
		}
		settings.Cues = cues
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return DramaCaptions{}, err
	}
	fields := map[string]any{"captions_json": string(payload)}
	if episode.FinalResourceID != "" {
		fields["final_stale"] = true
	}
	if err := s.repo.UpdateDramaEpisodeUser(episode.ID, fields); err != nil {
		return DramaCaptions{}, err
	}
	if episode.FinalResourceID != "" {
		if err := s.reopenDrama(productionRow); err != nil {
			return DramaCaptions{}, err
		}
	}
	episode.CaptionsJSON = string(payload)
	segments, shots, err := s.dramaEpisodeParts(episode.ID)
	if err != nil {
		return DramaCaptions{}, err
	}
	return dramaCaptionsView(episode, segments, shots), nil
}

// normalizeDramaCaptionCues 校验改写后的字幕。逐词时间只在与文字一致且落在字幕时长内时保留，否则按字数重新估算。
func normalizeDramaCaptionCues(input []DramaCaptionCue) ([]DramaCaptionCue, error) {
	if len(input) > dramaMaxCaptionCues {
		return nil, BadAuthRequest(fmt.Sprintf("an episode can have at most %d captions", dramaMaxCaptionCues))
	}
	cues := make([]DramaCaptionCue, 0, len(input))
	for i, cue := range input {
		cue.Text = strings.TrimSpace(strings.ReplaceAll(cue.Text, "\r", ""))
		cue.ShotID = strings.TrimSpace(cue.ShotID)
		if cue.Text == "" || utf8.RuneCountInString(cue.Text) > dramaMaxCaptionRunes {
			return nil, BadAuthRequest(fmt.Sprintf("caption %d: text must have 1 to %d characters", i+1, dramaMaxCaptionRunes))
		}
		if cue.StartMs < 0 || cue.DurationMs < 300 || cue.DurationMs > 30000 {
			return nil, BadAuthRequest(fmt.Sprintf("caption %d: start cannot be negative and the duration must be between 300 ms and 30 s", i+1))
		}
		if !dramaCaptionWordsValid(cue) {
			cue.Words = estimateDramaCaptionWords(cue.Text, cue.DurationMs)
		}
		cues = append(cues, cue)
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].StartMs < cues[j].StartMs })
	return cues, nil
}

func dramaCaptionWordsValid(cue DramaCaptionCue) bool {
	if len(cue.Words) == 0 {
		return false
	}
	var joined strings.Builder
	cursor := int64(0)
	for _, word := range cue.Words {
		if word.StartMs < cursor || word.DurationMs <= 0 || word.StartMs+word.DurationMs > cue.DurationMs {
			return false
		}
		cursor = word.StartMs + word.DurationMs
		joined.WriteString(word.Text)
	}
	strip := func(value string) string { return strings.Join(strings.Fields(value), "") }
	return strip(joined.String()) == strip(cue.Text)
}
