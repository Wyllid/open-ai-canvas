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
