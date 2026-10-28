package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

// MCPTool is one tool the MCP endpoint advertises to an external agent such as
// Codex or Claude Code. InputSchema is a JSON Schema object.
type MCPTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// MCPToolResult is a tool result that carries images next to its JSON value, so an
// agent with vision can look at them (for example frames of a rendered take).
type MCPToolResult struct {
	Value  any
	Images []MCPImage
}

type MCPImage struct {
	MimeType string
	Data     []byte
}

// ErrMCPToolNotFound reports a tools/call for a name the endpoint does not expose.
var ErrMCPToolNotFound = errors.New("unknown MCP tool")

// mcpCanvasTools are the cloud agent tools that MCP reuses unchanged, with an
// extra required canvasId. Media generation, approvals, plan/ask_user and
// lessons stay inside the in-app agent: an external agent prepares nodes and
// prompts, and generation is still started by the person in the canvas.
var mcpCanvasTools = []string{
	agenttool.CanvasListNodeTypes,
	agenttool.CanvasGetState,
	agenttool.CanvasReadText,
	agenttool.CanvasReadBatchTable,
	agenttool.CanvasReadStoryboard,
	agenttool.ModelList,
	agenttool.TaskGet,
	agenttool.CanvasApplyOps,
	agenttool.CanvasArrangeNodes,
	agenttool.CanvasCreateStoryboard,
	agenttool.CanvasEditStoryboard,
	agenttool.CanvasCreateCharacter,
	agenttool.CanvasEditBatchTable,
}

var mcpSkillTools = []string{agenttool.SkillSearch, agenttool.SkillReadFile}

const (
	mcpCanvasList      = "canvas_list"
	mcpDramaList       = "drama_list"
	mcpDramaGet        = "drama_get"
	mcpDramaEpisodeGet = "drama_episode_get"
	mcpDramaJobs       = "drama_jobs"
	mcpDramaCasts      = "drama_casts"
	mcpDramaShotUpdate = "drama_shot_update"
	mcpDramaShotInsert = "drama_shot_insert"
	mcpDramaCastUpdate = "drama_cast_update"
	mcpDramaEpisodeSet = "drama_episode_update"
	mcpDramaMusicSet   = "drama_music_set"
	mcpAudioResources  = "audio_resources"
	mcpDramaTakeFrames = "drama_take_frames"
	mcpDramaTakeReview = "drama_take_review"
	mcpDramaTakeSelect = "drama_take_select"
)

const mcpCanvasIDDescription = "Canvas ID from canvas_list."

// MCPUser returns the local admin account that MCP calls act as. The endpoint has no
// login of its own, so a missing, disabled or non-admin account refuses every call.
func (s *Service) MCPUser(username string) (*model.User, error) {
	user, err := s.repo.UserByUsername(auth.NormalizeUsername(username))
	if err != nil || user == nil || user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive {
		return nil, errors.New("MCP admin account is not available")
	}
	return user, nil
}

// MCPTools lists every tool the MCP endpoint exposes, in a stable order.
func (s *Service) MCPTools() ([]MCPTool, error) {
	tools := []MCPTool{
		mcpTool(mcpCanvasList, "List the canvases of the signed-in admin, newest first. Use the returned id as canvasId in the other canvas tools.", map[string]any{
			"search":   map[string]any{"type": "string", "description": "Optional title filter."},
			"page":     map[string]any{"type": "integer", "minimum": 1},
			"pageSize": map[string]any{"type": "integer", "minimum": 1, "maximum": 50},
		}),
		mcpTool(mcpDramaList, "List drama productions with their status.", map[string]any{
			"query":    map[string]any{"type": "string"},
			"page":     map[string]any{"type": "integer", "minimum": 1},
			"pageSize": map[string]any{"type": "integer", "minimum": 1, "maximum": 50},
		}),
		mcpTool(mcpDramaGet, "Read one drama production: settings, episodes and their stages.", map[string]any{
			"projectId": map[string]any{"type": "string"},
		}, "projectId"),
		mcpTool(mcpDramaEpisodeGet, "Read one drama episode: script, shots, segments and their media status.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"episodeId": map[string]any{"type": "string"},
		}, "projectId", "episodeId"),
		mcpTool(mcpDramaJobs, "List the latest pipeline jobs of a drama with their status and errors, newest first.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"limit":     map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
		}, "projectId"),
		mcpTool(mcpDramaCasts, "List the characters, scenes and props of a drama with their appearance notes and reference image status.", map[string]any{
			"projectId": map[string]any{"type": "string"},
		}, "projectId"),
		mcpTool(mcpDramaShotUpdate, "Edit one shot's text: speaker, dialogue, action, framing, camera, prompts, transition or duration. Only the fields you send change. Nothing is regenerated; the person decides when to render again.", map[string]any{
			"projectId":       map[string]any{"type": "string"},
			"shotId":          map[string]any{"type": "string"},
			"speaker":         map[string]any{"type": "string"},
			"dialogue":        map[string]any{"type": "string"},
			"action":          map[string]any{"type": "string"},
			"shotSize":        map[string]any{"type": "string"},
			"camera":          map[string]any{"type": "string"},
			"imagePrompt":     map[string]any{"type": "string"},
			"videoPrompt":     map[string]any{"type": "string"},
			"transition":      map[string]any{"type": "string", "enum": []string{"cut", "fadeblack", "fadewhite"}, "description": "Transition into this shot. A project-wide transition setting overrides it."},
			"durationSeconds": map[string]any{"type": "number", "minimum": 0},
		}, "projectId", "shotId"),
		mcpTool(mcpDramaShotInsert, "Insert an empty shot before or after a shot, in the same beat. Fill it with drama_shot_update.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"shotId":    map[string]any{"type": "string"},
			"position":  map[string]any{"type": "string", "enum": []string{"before", "after"}},
		}, "projectId", "shotId", "position"),
		mcpTool(mcpDramaCastUpdate, "Edit a character, scene or prop's name, aliases, appearance, description or voice notes. The reference image is not regenerated.", map[string]any{
			"projectId":         map[string]any{"type": "string"},
			"castId":            map[string]any{"type": "string"},
			"name":              map[string]any{"type": "string"},
			"aliases":           map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			"appearance":        map[string]any{"type": "string"},
			"description":       map[string]any{"type": "string"},
			"voiceInstructions": map[string]any{"type": "string"},
		}, "projectId", "castId"),
		mcpTool(mcpDramaEpisodeSet, "Rename an episode.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"episodeId": map[string]any{"type": "string"},
			"title":     map[string]any{"type": "string"},
		}, "projectId", "episodeId", "title"),
		mcpTool(mcpAudioResources, "List the admin's ready audio resources, newest first, to pick music cues from. Returns ids and durations only.", map[string]any{
			"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100},
		}),
		mcpTool(mcpDramaMusicSet, "Replace the music cues of an episode. Each cue places an audio resource on the music track at startMs (ms from the episode start); music is ducked under speech and the final mix is normalized to -14 LUFS. An empty list means no music. A rendered episode is marked stale and rendered again.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"episodeId": map[string]any{"type": "string"},
			"cues": map[string]any{"type": "array", "maxItems": dramaMaxMusicCues, "items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"label":         map[string]any{"type": "string", "description": "Cue name such as M1."},
					"resourceId":    map[string]any{"type": "string", "description": "Audio resource id from audio_resources."},
					"startMs":       map[string]any{"type": "integer", "minimum": 0},
					"durationMs":    map[string]any{"type": "integer", "minimum": 500},
					"sourceStartMs": map[string]any{"type": "integer", "minimum": 0, "description": "Where to start inside the audio file."},
					"volume":        map[string]any{"type": "number", "minimum": 0, "maximum": 2, "description": "0 or omitted uses the default music level (0.35)."},
				},
				"required": []string{"resourceId", "startMs", "durationMs"},
			}},
		}, "projectId", "episodeId", "cues"),
		mcpTool(mcpDramaTakeFrames, "Look at a segment video take: returns evenly spaced frames as images plus the take's details. Take ids are in the takes list of each segment in drama_episode_get.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"takeId":    map[string]any{"type": "string"},
			"count":     map[string]any{"type": "integer", "minimum": 1, "maximum": dramaMaxTakeFrames, "description": "Frames to return, default 4."},
		}, "projectId", "takeId"),
		mcpTool(mcpDramaTakeReview, "Record the review of a segment take: approve, fix_prompt (say what to change in promptFix) or new_take (say why a prompt fix is not enough). Recording a review never regenerates anything. An empty verdict clears the review.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"takeId":    map[string]any{"type": "string"},
			"verdict":   map[string]any{"type": "string", "enum": []string{"", DramaTakeApprove, DramaTakeFixPrompt, DramaTakeNewTake}},
			"score":     map[string]any{"type": "integer", "minimum": 1, "maximum": 5},
			"notes":     map[string]any{"type": "string", "description": "What is right or wrong, shot by shot. Required unless approved."},
			"promptFix": map[string]any{"type": "string", "description": "Suggested change to the segment prompt."},
		}, "projectId", "takeId", "verdict"),
		mcpTool(mcpDramaTakeSelect, "Use this take of a segment in the episode cut. The episode is rendered again locally; no video is generated. Do it only when the person chose the take.", map[string]any{
			"projectId": map[string]any{"type": "string"},
			"takeId":    map[string]any{"type": "string"},
		}, "projectId", "takeId"),
	}
	registry := cloudAgentRegistry()
	for _, name := range append(append([]string{}, mcpCanvasTools...), mcpSkillTools...) {
		binding, ok := registry.Lookup(name)
		if !ok {
			return nil, fmt.Errorf("cloud agent tool %s is not registered", name)
		}
		schema := binding.Definition.Parameters
		if isMCPCanvasTool(name) {
			var err error
			if schema, err = withRequiredCanvasID(schema); err != nil {
				return nil, fmt.Errorf("%s schema: %w", name, err)
			}
		}
		tools = append(tools, MCPTool{Name: name, Description: binding.Definition.Description, InputSchema: schema})
	}
	return tools, nil
}

// CallMCPTool runs one MCP tool call for userID and returns a JSON-encodable result.
// Argument and domain errors come back as errors; the caller reports them to the
// client as a tool error rather than a protocol error.
func (s *Service) CallMCPTool(userID, name string, arguments json.RawMessage) (any, error) {
	if len(arguments) == 0 || string(arguments) == "null" {
		arguments = json.RawMessage("{}")
	}
	switch name {
	case mcpCanvasList:
		var args struct {
			Search   string `json:"search"`
			Page     int    `json:"page"`
			PageSize int    `json:"pageSize"`
		}
		if err := decodeCloudAgentJSONObject(string(arguments), &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		if args.PageSize <= 0 || args.PageSize > 50 {
			args.PageSize = 20
		}
		return s.UserCanvasProjectsPage(userID, args.Page, args.PageSize, "", strings.TrimSpace(args.Search), "")
	case mcpDramaList:
		var args struct {
			Query    string `json:"query"`
			Page     int    `json:"page"`
			PageSize int    `json:"pageSize"`
		}
		if err := decodeCloudAgentJSONObject(string(arguments), &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		if args.Page < 1 {
			args.Page = 1
		}
		if args.PageSize <= 0 || args.PageSize > 50 {
			args.PageSize = 20
		}
		return s.ListDramas(userID, DramaListRequest{Page: args.Page, PageSize: args.PageSize, Query: strings.TrimSpace(args.Query)})
	case mcpDramaGet:
		var args struct {
			ProjectID string `json:"projectId"`
		}
		if err := decodeCloudAgentJSONObject(string(arguments), &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		if strings.TrimSpace(args.ProjectID) == "" {
			return nil, BadAuthRequest("projectId is required")
		}
		return s.DramaSummary(userID, strings.TrimSpace(args.ProjectID))
	case mcpDramaEpisodeGet:
		var args struct {
			ProjectID string `json:"projectId"`
			EpisodeID string `json:"episodeId"`
		}
		if err := decodeCloudAgentJSONObject(string(arguments), &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		if strings.TrimSpace(args.ProjectID) == "" || strings.TrimSpace(args.EpisodeID) == "" {
			return nil, BadAuthRequest("projectId and episodeId are required")
		}
		return s.DramaEpisodeDetail(userID, strings.TrimSpace(args.ProjectID), strings.TrimSpace(args.EpisodeID))
	case mcpDramaJobs:
		var args struct {
			ProjectID string `json:"projectId"`
			Limit     int    `json:"limit"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID); err != nil {
			return nil, err
		}
		if args.Limit <= 0 || args.Limit > 100 {
			args.Limit = 20
		}
		return s.DramaJobs(userID, args.ProjectID, args.Limit)
	case mcpDramaCasts:
		var args struct {
			ProjectID string `json:"projectId"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID); err != nil {
			return nil, err
		}
		return s.DramaCasts(userID, args.ProjectID)
	case mcpDramaShotUpdate:
		var args struct {
			ProjectID string `json:"projectId"`
			ShotID    string `json:"shotId"`
			UpdateDramaShotRequest
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.ShotID); err != nil {
			return nil, err
		}
		return s.UpdateDramaShot(userID, args.ProjectID, args.ShotID, args.UpdateDramaShotRequest)
	case mcpDramaShotInsert:
		var args struct {
			ProjectID string `json:"projectId"`
			ShotID    string `json:"shotId"`
			Position  string `json:"position"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.ShotID); err != nil {
			return nil, err
		}
		return s.InsertDramaShot(userID, args.ProjectID, args.ShotID, InsertDramaShotRequest{Position: args.Position})
	case mcpDramaCastUpdate:
		var args struct {
			ProjectID         string    `json:"projectId"`
			CastID            string    `json:"castId"`
			Name              *string   `json:"name"`
			Aliases           *[]string `json:"aliases"`
			Appearance        *string   `json:"appearance"`
			Description       *string   `json:"description"`
			VoiceInstructions *string   `json:"voiceInstructions"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.CastID); err != nil {
			return nil, err
		}
		return s.UpdateDramaCast(userID, args.ProjectID, args.CastID, UpdateDramaCastRequest{Name: args.Name, Aliases: args.Aliases, Appearance: args.Appearance, Description: args.Description, VoiceInstructions: args.VoiceInstructions})
	case mcpDramaEpisodeSet:
		var args struct {
			ProjectID string `json:"projectId"`
			EpisodeID string `json:"episodeId"`
			Title     string `json:"title"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.EpisodeID); err != nil {
			return nil, err
		}
		title := strings.TrimSpace(args.Title)
		if title == "" {
			return nil, BadAuthRequest("title is required")
		}
		return s.UpdateDramaEpisode(userID, args.ProjectID, args.EpisodeID, UpdateDramaEpisodeRequest{Title: &title})
	case mcpAudioResources:
		var args struct {
			Limit int `json:"limit"`
		}
		if err := decodeMCPDramaArgs(arguments, &args); err != nil {
			return nil, err
		}
		return s.DramaAudioResources(userID, args.Limit)
	case mcpDramaMusicSet:
		var args struct {
			ProjectID string          `json:"projectId"`
			EpisodeID string          `json:"episodeId"`
			Cues      []DramaMusicCue `json:"cues"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.EpisodeID); err != nil {
			return nil, err
		}
		return s.SetDramaMusic(userID, args.ProjectID, args.EpisodeID, SetDramaMusicRequest{Cues: args.Cues})
	case mcpDramaTakeFrames:
		var args struct {
			ProjectID string `json:"projectId"`
			TakeID    string `json:"takeId"`
			Count     int    `json:"count"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.TakeID); err != nil {
			return nil, err
		}
		take, frames, err := s.DramaTakeFrames(userID, args.ProjectID, args.TakeID, args.Count)
		if err != nil {
			return nil, err
		}
		result := &MCPToolResult{Value: take}
		for _, frame := range frames {
			result.Images = append(result.Images, MCPImage{MimeType: "image/jpeg", Data: frame})
		}
		return result, nil
	case mcpDramaTakeReview:
		var args struct {
			ProjectID string `json:"projectId"`
			TakeID    string `json:"takeId"`
			DramaTakeReview
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.TakeID); err != nil {
			return nil, err
		}
		args.Reviewer = "agent"
		return s.ReviewDramaTake(userID, args.ProjectID, args.TakeID, args.DramaTakeReview)
	case mcpDramaTakeSelect:
		var args struct {
			ProjectID string `json:"projectId"`
			TakeID    string `json:"takeId"`
		}
		if err := decodeMCPDramaArgs(arguments, &args, &args.ProjectID, &args.TakeID); err != nil {
			return nil, err
		}
		return s.SelectDramaTake(userID, args.ProjectID, args.TakeID)
	}
	if isMCPCanvasTool(name) {
		canvasID, rest, err := splitMCPCanvasID(arguments)
		if err != nil {
			return nil, err
		}
		if _, err := s.repo.CanvasProjectForUser(userID, canvasID); err != nil {
			return nil, err
		}
		return s.callMCPAgentTool(userID, canvasID, name, rest)
	}
	for _, skillTool := range mcpSkillTools {
		if name == skillTool {
			return s.callMCPAgentTool(userID, "", name, arguments)
		}
	}
	return nil, ErrMCPToolNotFound
}

func (s *Service) callMCPAgentTool(userID, canvasID, name string, arguments json.RawMessage) (any, error) {
	binding, ok := cloudAgentRegistry().Lookup(name)
	if !ok {
		return nil, ErrMCPToolNotFound
	}
	call := cloudAgentCall{ID: "mcp-" + newID()}
	call.Function.Name = name
	call.Function.Arguments = string(arguments)
	handler := binding.Handler
	if handler.Write != nil {
		policy, err := s.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		return handler.Write(s.repo, userID, canvasID, call, policy)
	}
	if handler.Read == nil {
		return nil, ErrMCPToolNotFound
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvasID}}
	if name == agenttool.SkillSearch || name == agenttool.SkillReadFile {
		skills, err := s.mcpAddedSkills(userID)
		if err != nil {
			return nil, err
		}
		state.Skills = skills
	}
	return handler.Read(s.repo, userID, state, call, s)
}

// mcpAddedSkills loads the installed and enabled skills, the same set the in-app
// agent may be given, so skill_search and skill_read_file can see them.
func (s *Service) mcpAddedSkills(userID string) ([]cloudAgentSkill, error) {
	added, err := s.AddedSkills(userID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(added))
	for _, item := range added {
		if item.IsAdded && strings.TrimSpace(item.SkillID) != "" {
			ids = append(ids, item.SkillID)
		}
	}
	skills := make([]cloudAgentSkill, 0, len(ids))
	for _, id := range ids {
		// A disabled skill is skipped rather than failing the whole call.
		loaded, err := s.cloudAgentSkills(userID, []string{id})
		if err != nil {
			continue
		}
		skills = append(skills, loaded...)
	}
	return skills, nil
}

// decodeMCPDramaArgs decodes strictly and trims the required ids, so a missing id
// is reported by name instead of reaching the drama service as an empty lookup.
func decodeMCPDramaArgs(arguments json.RawMessage, target any, ids ...*string) error {
	if err := decodeCloudAgentJSONObject(string(arguments), target); err != nil {
		return cloudAgentJSONArgumentError(err)
	}
	for _, id := range ids {
		*id = strings.TrimSpace(*id)
		if *id == "" {
			return BadAuthRequest("projectId and the item id are required")
		}
	}
	return nil
}

func isMCPCanvasTool(name string) bool {
	for _, item := range mcpCanvasTools {
		if item == name {
			return true
		}
	}
	return false
}

// splitMCPCanvasID removes canvasId from the arguments, because the cloud agent
// tool schemas are strict and do not accept it.
func splitMCPCanvasID(arguments json.RawMessage) (string, json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(arguments, &fields); err != nil || fields == nil {
		return "", nil, BadAuthRequest("tool arguments must be a JSON object")
	}
	var canvasID string
	if raw, ok := fields["canvasId"]; ok {
		if err := json.Unmarshal(raw, &canvasID); err != nil {
			return "", nil, BadAuthRequest("canvasId must be a string")
		}
	}
	canvasID = strings.TrimSpace(canvasID)
	if canvasID == "" {
		return "", nil, BadAuthRequest("canvasId is required; call canvas_list first")
	}
	delete(fields, "canvasId")
	rest, err := json.Marshal(fields)
	if err != nil {
		return "", nil, err
	}
	return canvasID, rest, nil
}

func withRequiredCanvasID(schema json.RawMessage) (json.RawMessage, error) {
	var object map[string]any
	if err := json.Unmarshal(schema, &object); err != nil {
		return nil, err
	}
	if object == nil {
		object = map[string]any{}
	}
	object["type"] = "object"
	properties, _ := object["properties"].(map[string]any)
	if properties == nil {
		properties = map[string]any{}
	}
	properties["canvasId"] = map[string]any{"type": "string", "description": mcpCanvasIDDescription}
	object["properties"] = properties
	required := []any{"canvasId"}
	if existing, ok := object["required"].([]any); ok {
		for _, item := range existing {
			if item != "canvasId" {
				required = append(required, item)
			}
		}
	}
	object["required"] = required
	return json.Marshal(object)
}

func mcpTool(name, description string, properties map[string]any, required ...string) MCPTool {
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	raw, _ := json.Marshal(schema)
	return MCPTool{Name: name, Description: description, InputSchema: raw}
}
