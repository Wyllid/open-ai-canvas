package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// 审阅工序（E4）：同一份剧本由不同"岗位"各读一遍，只提出问题和最小修改，不生成媒体、不自动采纳。
// 全部岗位合并在一次文本调用里完成，每条意见标明岗位；用户或智能体逐条采纳后才改镜头。

const (
	DramaReviewPassScript     = "script"
	DramaReviewPassDirection  = "direction"
	DramaReviewPassCamera     = "camera"
	DramaReviewPassContinuity = "continuity"
	DramaReviewPassSound      = "sound"

	DramaFindingOpen      = "open"
	DramaFindingAccepted  = "accepted"
	DramaFindingDismissed = "dismissed"

	dramaMaxReviewFindings = 40
)

var dramaReviewPassOrder = []string{DramaReviewPassScript, DramaReviewPassDirection, DramaReviewPassCamera, DramaReviewPassContinuity, DramaReviewPassSound}

var dramaReviewPassBrief = map[string]string{
	DramaReviewPassScript:     "Script: every source line of dialogue is present or deliberately cut; each scene has a goal, an obstacle and a change; lines sound like their speaker; no exposition the viewer already sees; the episode ends on a question, reveal or turn.",
	DramaReviewPassDirection:  "Direction: each shot has one clear subject and action; emotion is shown through action and framing; performance notes are concrete (eyes, hands), not adjectives; pacing fits the shot durations.",
	DramaReviewPassCamera:     "Camera: shot sizes vary (no three in a row at the same size without reason); consecutive shots change subject, size by two steps or angle by about 90°; moves are motivated; dialogue keeps the 180° line and matching eyelines.",
	DramaReviewPassContinuity: "Continuity: costume, props, injuries and light carry from shot to shot; screen direction is kept; every shot restates its location, time of day and who is where instead of relying on the previous one.",
	DramaReviewPassSound:      "Sound: every spoken line has a speaker and fits its shot (about 2.5 words per second, or 4 Chinese characters per second); moments that need silence, music or a sound effect are noted in the action.",
}

// dramaReviewFixFieldOrder 是意见可以直接改写的镜头字段；其余问题只给文字说明。
var dramaReviewFixFieldOrder = []string{"speaker", "dialogue", "action", "shotSize", "camera", "imagePrompt", "videoPrompt", "transition", "durationSeconds"}

var dramaReviewFixFields = func() map[string]bool {
	fields := map[string]bool{}
	for _, field := range dramaReviewFixFieldOrder {
		fields[field] = true
	}
	return fields
}()

// DramaReviewFinding 是一条审阅意见：哪个岗位、哪个镜头、什么问题，以及可选的最小修改。
type DramaReviewFinding struct {
	ID         string `json:"id"`
	Pass       string `json:"pass"`
	ShotID     string `json:"shotId,omitempty"`
	ShotNumber int    `json:"shotNumber,omitempty"`
	Severity   string `json:"severity"`
	Problem    string `json:"problem"`
	Field      string `json:"field,omitempty"`
	Value      string `json:"value,omitempty"`
	// Before 是这条修改要替换的字段原值；采纳时字段已不是这个值，说明镜头在审阅后被改过，不再自动覆盖。
	Before *string `json:"before,omitempty"`
	Status string  `json:"status"`
}

// DramaReviewShot 记录提交审阅时第 N 号镜头是谁、可改字段是什么样，意见按它对回镜头。
type DramaReviewShot struct {
	ID     string `json:"id"`
	Digest string `json:"digest"`
}

// DramaReviewState 保存一集最近一次审阅：请求的岗位、进度与意见。
type DramaReviewState struct {
	RequestID  string               `json:"requestId"`
	Status     string               `json:"status"`
	Passes     []string             `json:"passes"`
	Error      string               `json:"error,omitempty"`
	ReviewedAt string               `json:"reviewedAt,omitempty"`
	Findings   []DramaReviewFinding `json:"findings"`
	// Shots 是提交给文本模型的镜头顺序；审阅期间插入或删除镜头不会让意见错位。
	Shots []DramaReviewShot `json:"shots,omitempty"`
	// Waiting 只在读取时给出：审阅在排队但制作没有运行，调度不会接手。
	Waiting string `json:"waiting,omitempty"`
}

type RunDramaReviewRequest struct {
	Passes []string `json:"passes"`
}

type ResolveDramaReviewFindingRequest struct {
	Accept bool `json:"accept"`
}

type dramaReviewPayload struct {
	RequestID string `json:"requestId"`
}

func decodeDramaReview(raw string) *DramaReviewState {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var state DramaReviewState
	if json.Unmarshal([]byte(raw), &state) != nil || state.RequestID == "" {
		return nil
	}
	if state.Findings == nil {
		state.Findings = []DramaReviewFinding{}
	}
	return &state
}

func normalizeDramaReviewPasses(passes []string) ([]string, error) {
	wanted := map[string]bool{}
	for _, pass := range passes {
		pass = strings.TrimSpace(pass)
		if _, ok := dramaReviewPassBrief[pass]; !ok {
			return nil, BadAuthRequest("unknown review pass: " + pass + " (use script, direction, camera, continuity or sound)")
		}
		wanted[pass] = true
	}
	out := []string{}
	for _, pass := range dramaReviewPassOrder {
		if wanted[pass] || len(wanted) == 0 {
			out = append(out, pass)
		}
	}
	return out, nil
}

// RunDramaReview 请求对一集剧本做一次审阅；只花一次文本调用，结果作为意见列出，不改任何镜头。
func (s *Service) RunDramaReview(userID, projectID, episodeID string, req RunDramaReviewRequest) (*DramaReviewState, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	// 审阅由调度循环提交；暂停或未开始的制作不跑调度，恢复它会连带继续其他付费生成，所以交给用户决定。
	if productionRow.Status != model.DramaStatusRunning && productionRow.Status != model.DramaStatusCompleted {
		return nil, BadAuthRequest("the production is not running; start or resume it to run a review")
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, err
	}
	if len(shots) == 0 {
		return nil, BadAuthRequest("the episode has no shots to review yet")
	}
	if current := decodeDramaReview(episode.ReviewJSON); current != nil && (current.Status == model.DramaMediaQueued || current.Status == model.DramaMediaRunning) {
		return current, nil
	}
	passes, err := normalizeDramaReviewPasses(req.Passes)
	if err != nil {
		return nil, err
	}
	state := &DramaReviewState{RequestID: newID(), Status: model.DramaMediaQueued, Passes: passes, Findings: []DramaReviewFinding{}}
	if err := s.saveDramaReview(episode.ID, state); err != nil {
		return nil, err
	}
	if err := s.reopenDrama(productionRow); err != nil {
		return nil, err
	}
	return state, nil
}

func (s *Service) saveDramaReview(episodeID string, state *DramaReviewState) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return s.repo.UpdateDramaEpisodeMeta(episodeID, map[string]any{"review_json": string(payload)})
}

// ResolveDramaReviewFinding 采纳或驳回一条意见；采纳且带修改时按普通镜头编辑写入（本段提示词与视频随之过期）。
// 镜头在审阅后被删或对应字段被改过时拒绝采纳，避免用旧意见覆盖新内容。
func (s *Service) ResolveDramaReviewFinding(userID, projectID, episodeID, findingID string, req ResolveDramaReviewFindingRequest) (*DramaReviewState, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	findingID = strings.TrimSpace(findingID)
	state := decodeDramaReview(episode.ReviewJSON)
	if state == nil {
		return nil, NotFound("the episode has no review")
	}
	finding := state.finding(findingID)
	if finding == nil {
		return nil, NotFound("finding not found")
	}
	if finding.Status != DramaFindingOpen {
		return state, nil
	}
	status := DramaFindingDismissed
	if req.Accept {
		status = DramaFindingAccepted
		if finding.Field != "" && finding.ShotID != "" {
			if err := s.applyDramaFinding(userID, projectID, project.ID, *finding); err != nil {
				return nil, err
			}
		}
	}
	return s.updateDramaReview(project.ID, episode.ID, func(current *DramaReviewState) {
		if target := current.finding(findingID); target != nil && target.Status == DramaFindingOpen {
			target.Status = status
		}
	})
}

func (state *DramaReviewState) finding(id string) *DramaReviewFinding {
	for i := range state.Findings {
		if state.Findings[i].ID == id {
			return &state.Findings[i]
		}
	}
	return nil
}

func (s *Service) applyDramaFinding(userID, projectID, internalProjectID string, finding DramaReviewFinding) error {
	shot, err := s.repo.DramaShot(internalProjectID, finding.ShotID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("this shot was removed after the review; dismiss the finding")
		}
		return err
	}
	if finding.Before != nil && dramaShotFieldValue(*shot, finding.Field) != *finding.Before {
		return BadAuthRequest("the shot's " + finding.Field + " changed after the review; edit it yourself or dismiss the finding")
	}
	patch, err := dramaFindingPatch(finding)
	if err != nil {
		return err
	}
	_, err = s.UpdateDramaShot(userID, projectID, finding.ShotID, patch)
	return err
}

// updateDramaReview 以读-改-比较写入的方式更新审阅状态：两次并发的采纳或新开审阅不会互相覆盖。
func (s *Service) updateDramaReview(projectID, episodeID string, mutate func(*DramaReviewState)) (*DramaReviewState, error) {
	for attempt := 0; attempt < 5; attempt++ {
		episode, err := s.repo.DramaEpisode(projectID, episodeID)
		if err != nil {
			return nil, err
		}
		state := decodeDramaReview(episode.ReviewJSON)
		if state == nil {
			return nil, NotFound("the episode has no review")
		}
		mutate(state)
		payload, err := json.Marshal(state)
		if err != nil {
			return nil, err
		}
		swapped, err := s.repo.SwapDramaEpisodeReview(episode.ID, episode.ReviewJSON, string(payload))
		if err != nil {
			return nil, err
		}
		if swapped {
			return state, nil
		}
	}
	return nil, NewAppError(http.StatusConflict, "the review changed while saving; reload and try again")
}

// dramaShotFieldValue 是镜头上意见可改字段的当前值，用于判断意见是否已过时。
func dramaShotFieldValue(shot model.DramaShot, field string) string {
	switch field {
	case "speaker":
		return shot.Speaker
	case "dialogue":
		return shot.Dialogue
	case "action":
		return shot.Action
	case "shotSize":
		return shot.ShotSize
	case "camera":
		return shot.Camera
	case "imagePrompt":
		return shot.ImagePrompt
	case "videoPrompt":
		return shot.VideoPrompt
	case "transition":
		return shot.Transition
	case "durationSeconds":
		return strconv.FormatFloat(float64(shot.DurationMs)/1000, 'g', -1, 64)
	}
	return ""
}

// dramaShotReviewDigest 摘要镜头全部可改字段；提交与回收时不同，说明镜头在审阅期间被改过。
func dramaShotReviewDigest(shot model.DramaShot) string {
	hash := sha256.New()
	for _, field := range dramaReviewFixFieldOrder {
		hash.Write([]byte(dramaShotFieldValue(shot, field)))
		hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))[:16]
}

func dramaReviewShots(shots []model.DramaShot) []DramaReviewShot {
	out := make([]DramaReviewShot, 0, len(shots))
	for _, shot := range shots {
		out = append(out, DramaReviewShot{ID: shot.ID, Digest: dramaShotReviewDigest(shot)})
	}
	return out
}

func dramaFindingPatch(finding DramaReviewFinding) (UpdateDramaShotRequest, error) {
	value := finding.Value
	var patch UpdateDramaShotRequest
	switch finding.Field {
	case "speaker":
		patch.Speaker = &value
	case "dialogue":
		patch.Dialogue = &value
	case "action":
		patch.Action = &value
	case "shotSize":
		patch.ShotSize = &value
	case "camera":
		patch.Camera = &value
	case "imagePrompt":
		patch.ImagePrompt = &value
	case "videoPrompt":
		patch.VideoPrompt = &value
	case "transition":
		patch.Transition = &value
	case "durationSeconds":
		var seconds float64
		if _, err := fmt.Sscanf(strings.TrimSpace(value), "%g", &seconds); err != nil || seconds <= 0 {
			return patch, BadAuthRequest("the suggested duration is not a number of seconds")
		}
		patch.DurationSeconds = &seconds
	default:
		return patch, BadAuthRequest("this finding has no field to change")
	}
	return patch, nil
}

// ===== 调度 =====

func (r *dramaRun) planReview(e *model.DramaEpisode) bool {
	state := decodeDramaReview(e.ReviewJSON)
	if state == nil || (state.Status != model.DramaMediaQueued && state.Status != model.DramaMediaRunning) {
		return false
	}
	r.enqueue(model.DramaJobReview, e.ID, "", "", episodePriority(50, e.Number), fmt.Sprintf("第 %d 集 审阅", e.Number), dramaReviewPayload{RequestID: state.RequestID})
	return true
}

func (r *dramaRun) loadReviewJob(job *model.DramaJob) (*model.DramaEpisode, *DramaReviewState, bool, error) {
	episode, err := r.s.repo.DramaEpisode(r.project.ID, job.EpisodeID)
	if err != nil {
		return nil, nil, false, err
	}
	var payload dramaReviewPayload
	_ = json.Unmarshal([]byte(job.PayloadJSON), &payload)
	state := decodeDramaReview(episode.ReviewJSON)
	if state == nil || state.RequestID != payload.RequestID {
		return episode, state, false, nil
	}
	return episode, state, true, nil
}

func (r *dramaRun) submitReview(job *model.DramaJob) (*model.Task, bool, error) {
	episode, state, current, err := r.loadReviewJob(job)
	if err != nil || !current || state.Status == model.DramaMediaReady {
		return nil, true, err
	}
	shots, err := r.s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, false, err
	}
	if len(shots) == 0 {
		return nil, true, nil
	}
	chapters, err := r.loadChapters(decodeStringList(episode.ChapterIDsJSON))
	if err != nil {
		return nil, false, err
	}
	prompt := r.reviewPrompt(episode, shots, chapters, state.Passes)
	task, err := r.createTask("text", "text", prompt, r.textInput(job, dramaReviewSystemPrompt))
	if err == nil {
		state.Status, state.Shots = model.DramaMediaRunning, dramaReviewShots(shots)
		err = r.s.saveDramaReview(episode.ID, state)
	}
	return task, false, err
}

const dramaReviewSystemPrompt = `You are a film production review crew reading a short-drama episode before any video is generated. Each requested role reads the same shot list with its own checklist. You only report problems and propose the smallest fix; you never rewrite the episode.

Reply with one JSON object and nothing else:
{"findings":[{"pass":"<role>","shot":<shot number or 0 for the whole episode>,"severity":"high|medium|low","problem":"<one sentence>","field":"<optional: speaker|dialogue|action|shotSize|camera|imagePrompt|videoPrompt|transition|durationSeconds>","value":"<the full new value of that field>"}]}

Rules:
- Report only real problems a viewer would notice or that break continuity; an empty list is a valid answer.
- At most 8 findings per role, ranked by impact.
- A fix replaces the whole field, so "value" is the complete new text, in the same language as the script.
- transition is one of cut, fadeblack, fadewhite; durationSeconds is a number.
- Leave "field" out when the fix needs more than one field or a new shot; say what to do in "problem".`

func (r *dramaRun) reviewPrompt(episode *model.DramaEpisode, shots []model.DramaShot, chapters []production.Chapter, passes []string) string {
	castName := map[string]string{}
	for _, cast := range r.casts {
		castName[cast.ID] = cast.Name
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Production: %s\nEpisode %d: %s\nSynopsis: %s\n\nRoles to run:\n", r.project.Name, episode.Number, episode.Title, episode.Synopsis)
	for _, pass := range passes {
		fmt.Fprintf(&b, "- %s — %s\n", pass, dramaReviewPassBrief[pass])
	}
	b.WriteString("\nShot list:\n")
	for i, shot := range shots {
		names := []string{}
		for _, id := range decodeStringList(shot.CastIDsJSON) {
			if name := castName[id]; name != "" {
				names = append(names, name)
			}
		}
		fmt.Fprintf(&b, "\n#%d [segment %d] %.1fs · %s · %s · transition %s\nScene: %s\nCast: %s\n", i+1, shot.SegmentIndex+1, float64(shot.DurationMs)/1000, shot.ShotSize, shot.Camera, firstNonEmpty(shot.Transition, production.TransitionCut), shot.Scene, strings.Join(names, ", "))
		if shot.Dialogue != "" {
			fmt.Fprintf(&b, "Line (%s): %s\n", firstNonEmpty(shot.Speaker, "narrator"), shot.Dialogue)
		}
		if shot.Action != "" {
			fmt.Fprintf(&b, "Action: %s\n", shot.Action)
		}
		if shot.ImagePrompt != "" {
			fmt.Fprintf(&b, "Frame: %s\n", truncateRunes(shot.ImagePrompt, 400))
		}
	}
	if containsString(passes, DramaReviewPassScript) && len(chapters) > 0 {
		b.WriteString("\nSource text (check fidelity against it):\n")
		budget := 12000
		for _, chapter := range chapters {
			text := truncateRunes(chapter.Text, budget)
			budget -= len([]rune(text))
			fmt.Fprintf(&b, "\n## %s\n%s\n", chapter.Title, text)
			if budget <= 0 {
				break
			}
		}
	}
	return b.String()
}

func (r *dramaRun) applyReview(job *model.DramaJob, task *model.Task) error {
	episode, state, current, err := r.loadReviewJob(job)
	if err != nil || !current {
		return err
	}
	text, err := dramaTaskText(task)
	if err != nil {
		return err
	}
	shots, err := r.s.repo.DramaShots(episode.ID)
	if err != nil {
		return err
	}
	findings, err := parseDramaReviewFindings(text, state.Shots, shots, state.Passes)
	if err != nil {
		return err
	}
	state.Status, state.Error, state.Findings = model.DramaMediaReady, "", findings
	state.ReviewedAt = time.Now().UTC().Format(time.RFC3339)
	return r.s.saveDramaReview(episode.ID, state)
}

func (r *dramaRun) failReview(job *model.DramaJob, reason string) error {
	episode, state, current, err := r.loadReviewJob(job)
	if err != nil || !current {
		return err
	}
	state.Status, state.Error = model.DramaMediaFailed, truncateRunes(reason, 300)
	return r.s.saveDramaReview(episode.ID, state)
}

// parseDramaReviewFindings 把模型意见里的镜头编号按提交时的镜头顺序（sent）对回镜头：
// 审阅期间被删的镜头只留文字，被改过的镜头不带修改，编号显示为镜头现在的位置。
func parseDramaReviewFindings(text string, sent []DramaReviewShot, shots []model.DramaShot, passes []string) ([]DramaReviewFinding, error) {
	raw, err := production.ExtractJSONObject(text)
	if err != nil {
		return nil, fmt.Errorf("审阅结果解析失败：%w", err)
	}
	var parsed struct {
		Findings []struct {
			Pass     string          `json:"pass"`
			Shot     int             `json:"shot"`
			Severity string          `json:"severity"`
			Problem  string          `json:"problem"`
			Field    string          `json:"field"`
			Value    json.RawMessage `json:"value"`
		} `json:"findings"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, errors.New("审阅结果解析失败：不是有效的 JSON")
	}
	if len(sent) == 0 {
		sent = dramaReviewShots(shots)
	}
	currentIndex := map[string]int{}
	for i, shot := range shots {
		currentIndex[shot.ID] = i
	}
	findings := []DramaReviewFinding{}
	for _, item := range parsed.Findings {
		problem := strings.TrimSpace(item.Problem)
		if problem == "" || !containsString(passes, item.Pass) {
			continue
		}
		finding := DramaReviewFinding{ID: newID(), Pass: item.Pass, Severity: item.Severity, Problem: truncateRunes(problem, 600), Status: DramaFindingOpen}
		if finding.Severity != "high" && finding.Severity != "low" {
			finding.Severity = "medium"
		}
		if item.Shot >= 1 && item.Shot <= len(sent) {
			ref := sent[item.Shot-1]
			if index, ok := currentIndex[ref.ID]; ok {
				shot := shots[index]
				finding.ShotID, finding.ShotNumber = shot.ID, index+1
				if dramaReviewFixFields[item.Field] && dramaShotReviewDigest(shot) == ref.Digest {
					var value string
					if json.Unmarshal(item.Value, &value) != nil {
						value = strings.Trim(string(item.Value), `"`)
					}
					if value = strings.TrimSpace(value); value != "" {
						before := dramaShotFieldValue(shot, item.Field)
						finding.Field, finding.Value, finding.Before = item.Field, truncateRunes(value, 4000), &before
					}
				}
			}
		}
		findings = append(findings, finding)
		if len(findings) == dramaMaxReviewFindings {
			break
		}
	}
	return findings, nil
}
