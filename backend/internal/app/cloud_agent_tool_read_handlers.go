package app

import (
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func cloudAgentHandleModelList(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	if service == nil {
		return nil, BadAuthRequest("The model catalog service is unavailable")
	}
	intent, err := service.cloudAgentModelIntent(userID, state.Request.CanvasID, call.Function.Arguments)
	if err != nil {
		return nil, err
	}
	return service.cloudAgentModelList(intent)
}

func cloudAgentHandleAgentProfileRead(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.ProfileReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.Scope != model.AgentProfileScopeUser && args.Scope != model.AgentProfileScopeProject && args.Scope != model.AgentProfileScopeCanvas {
		return nil, BadAuthRequest("Invalid long-term preference scope")
	}
	if state.ProfileReads == nil {
		state.ProfileReads = map[string]bool{}
	}
	if state.ProfileReads[args.Scope] {
		return nil, BadAuthRequest("This preference layer was already read in this run; use the earlier tool result instead of reading it again")
	}
	available := make([]string, 0, len(state.Profile.Layers))
	for _, layer := range state.Profile.Layers {
		available = append(available, layer.Scope)
		if layer.Scope == args.Scope {
			state.ProfileReads[args.Scope] = true
			return map[string]any{"scope": layer.Scope, "revision": layer.Revision, "hash": layer.Hash, "content": layer.Content}, nil
		}
	}
	if len(available) == 0 {
		return nil, BadAuthRequest("This run has no long-term preference layers; do not call agent_profile_read")
	}
	return nil, BadAuthRequest("This preference layer is not in this run's fixed snapshot; the only readable layers are: " + strings.Join(available, "、") + ". Do not try other layers")
}

func cloudAgentHandlePlanUpdate(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentApplyPlanUpdate(state, call)
}

func cloudAgentHandleAskUser(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentAskUser(call, state)
}

func cloudAgentHandleRecallLessons(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentRecallLessons(repo, userID, call)
}

func cloudAgentHandleRememberLesson(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentRememberLesson(repo, userID, state, call)
}

func cloudAgentHandlePrevisSceneRead(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentPrevisSceneRead(repo, userID, state.Request.CanvasID, call)
}

func cloudAgentHandlePrevisPreview(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentPrevisPreview(repo, userID, state.Request.CanvasID, call)
}

func cloudAgentHandleCanvasListNodeTypes(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &struct{}{}); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	return cloudAgentNodeTypes(), nil
}

func cloudAgentHandleCanvasGetState(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.CanvasGetStateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	depth := 0
	if args.Depth != nil {
		depth = *args.Depth
	}
	if len(args.FocusNodeIDs) > 0 && args.Depth == nil {
		depth = 1
	}
	if args.Offset < 0 || args.ConnectionOffset < 0 || args.StoryboardOffset < 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: offset, connectionOffset and storyboardOffset must be non-negative integers")}
	}
	if len(args.NodeIDs) > 8 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: nodeIds can hold at most 8 node IDs")}
	}
	if len(args.FocusNodeIDs) > 8 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: focusNodeIds can hold at most 8 node IDs")}
	}
	if len(args.NodeIDs) > 0 && len(args.FocusNodeIDs) > 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: nodeIds and focusNodeIds are mutually exclusive")}
	}
	if depth < 0 || depth > 3 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: depth must be 0 to 3")}
	}
	if len(args.FocusNodeIDs) == 0 && args.Depth != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: depth can only be used with focusNodeIds")}
	}
	includeRelated := args.IncludeRelated != nil && *args.IncludeRelated
	if includeRelated && len(args.FocusNodeIDs) == 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: includeRelated can only be used with focusNodeIds")}
	}
	if includeRelated && args.Depth != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid canvas read arguments: includeRelated and depth cannot be used together")}
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if len(args.FocusNodeIDs) > 0 {
		if includeRelated {
			return cloudAgentCanvasStateWithRelated(repo, userID, state.Request.CanvasID, doc, args.Offset, args.FocusNodeIDs, args.StoryboardOffset, args.ConnectionOffset)
		}
		return cloudAgentCanvasStateWithFocus(repo, userID, state.Request.CanvasID, doc, args.Offset, args.FocusNodeIDs, depth, args.StoryboardOffset, args.ConnectionOffset)
	}
	return cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, args.Offset, args.NodeIDs, args.StoryboardOffset, args.ConnectionOffset)
}

func cloudAgentHandleCanvasReadText(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	var args agenttool.CanvasReadTextArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "Text node ID", 80); err != nil || args.Offset < 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid text node ID or paging arguments")}
	}
	if args.MaxChars == 0 {
		args.MaxChars = 16000
	}
	if args.MaxChars < 1 || args.MaxChars > 16000 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("maxChars must be between 1 and 16000")}
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	node := nodes[args.NodeID]
	if node == nil {
		return nil, BadAuthRequest("The target text node is not on this canvas")
	}
	kind := stringValue(node["type"])
	meta, _ := node["metadata"].(map[string]any)
	if kind != "text" && kind != "markdown" && kind != "file" {
		return nil, BadAuthRequest("The target node is not a readable text or file node")
	}
	if stringValue(meta["workflowKind"]) == "character" {
		return nil, BadAuthRequest("A character card body is not plain text; read the character field")
	}
	content := stringValue(meta["content"])
	resourceID := assets.ResourceID(stringValue(meta["storageKey"]))
	if resourceID == "" {
		resourceID = assets.ResourceID(content)
	}
	if resourceID != "" {
		if service == nil {
			return nil, BadAuthRequest("The text resource reader is unavailable")
		}
		resource, resourceErr := repo.ResourceForUser(userID, resourceID)
		if resourceErr != nil {
			return nil, resourceErr
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("The text resource has not finished uploading")
		}
		if !isReadableTextResource(resource) {
			return nil, BadAuthRequest("This file is not a directly readable text resource")
		}
		const maxTextResourceBytes = 32 << 20
		if resource.Size > maxTextResourceBytes {
			return nil, BadAuthRequest("The text resource exceeds 32MB; split the file before reading it")
		}
		stream, streamErr := service.OpenResourceRange(userID, resourceID, "")
		if streamErr != nil {
			return nil, streamErr
		}
		defer stream.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(stream.Body, maxTextResourceBytes+1))
		if readErr != nil {
			return nil, readErr
		}
		if len(body) > maxTextResourceBytes {
			return nil, BadAuthRequest("The text resource exceeds 32MB; split the file before reading it")
		}
		content = string(body)
	}
	if strings.TrimSpace(content) == "" {
		return map[string]any{"nodeId": args.NodeID, "title": stringValue(node["title"]), "content": "", "offset": args.Offset, "nextOffset": 0, "hasMore": false}, nil
	}
	runes := []rune(content)
	if args.Offset > len(runes) {
		return nil, &cloudAgentArgumentError{BadAuthRequest("The text read offset is beyond the end of the body")}
	}
	end := min(len(runes), args.Offset+args.MaxChars)
	chunk := string(runes[args.Offset:end])
	return map[string]any{
		"nodeId": args.NodeID, "title": stringValue(node["title"]),
		"content": chunk, "offset": args.Offset, "nextOffset": end,
		"hasMore": end < len(runes), "totalChars": utf8.RuneCountInString(content),
	}, nil
}

func cloudAgentHandleCanvasReadStoryboard(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.StoryboardReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "Storyboard node ID", 80); err != nil || args.Offset < 0 {
		return nil, BadAuthRequest("Invalid storyboard node ID or paging arguments")
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if _, _, _, err := storyboardNodeFromDocument(doc, args.NodeID); err != nil {
		return nil, err
	}
	view, err := cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, 0, []string{args.NodeID}, args.Offset)
	if err != nil {
		return nil, err
	}
	return cloudAgentStoryboardReadResult(view, args.NodeID, cloudAgentNodeHash(doc, args.NodeID))
}

func cloudAgentHandleCanvasReadBatchTable(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.BatchTableReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "Batch table node ID", 80); err != nil || args.Offset < 0 {
		return nil, BadAuthRequest("Invalid batch table node ID or paging arguments")
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if _, _, _, _, err := batchTableNodeFromDocument(doc, args.NodeID); err != nil {
		return nil, err
	}
	view, err := cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, 0, []string{args.NodeID}, args.Offset)
	if err != nil {
		return nil, err
	}
	return cloudAgentBatchTableReadResult(view, args.NodeID, cloudAgentNodeHash(doc, args.NodeID))
}

func cloudAgentHandleImageTextDetect(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.ImageNodeArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "Image node ID", 80); err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	node := nodes[args.NodeID]
	if node == nil || stringValue(node["type"]) != "image" {
		return nil, BadAuthRequest("The target node is not an image node")
	}
	ref, _, err := cloudAgentReference(repo, userID, node)
	if err != nil {
		return nil, err
	}
	return map[string]any{"nodeId": args.NodeID, "reference": ref, "status": "ready_for_visual_detection", "outputSchema": []string{"original", "text", "location"}, "nextStep": "Use the vision model to return a JSON array for this reference image; do not write the recognition result back to the canvas"}, nil
}

func cloudAgentHandleImageAnnotationRender(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if len(services) == 0 || services[0] == nil {
		return nil, BadAuthRequest("Annotation resource storage is unavailable")
	}
	return cloudAgentRenderImageAnnotations(repo, userID, state, call, services[0])
}

func cloudAgentHandleSkillSearch(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args struct {
		Keyword string `json:"keyword"`
		Limit   int    `json:"limit"`
		// 容忍模型顺手带上的 skillId（对齐 skill_read_file 的参数习惯）：
		// 检索范围恒为本轮已启用技能，该字段仅接收不生效。
		SkillID string `json:"skillId,omitempty"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	return cloudAgentSearchSkills(state.Skills, args.Keyword, args.Limit)
}

func cloudAgentHandleSkillReadFile(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	var args agenttool.SkillReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.Offset < 0 || (args.Path == "" && args.Offset != 0) {
		return nil, BadAuthRequest("Invalid skill read offset")
	}
	for _, skill := range state.Skills {
		if skill.ID == args.SkillID {
			if args.Path == "" {
				return map[string]any{"version": skill.Version, "entryPath": cloudAgentSkillEntryPath, "files": cloudAgentSkillPaths(skill), "guidance": "Read SKILL.md first, then only the reference files the entry point explicitly references and this task needs. Only paths listed in files can be read; do not list directories again or guess paths"}, nil
			}
			if service != nil {
				detail, err := service.SkillDetail(userID, skill.ID)
				if err != nil {
					return nil, err
				}
				if !detail.IsAdded || detail.Status != 1 || detail.VersionID != skill.Version || detail.ContentHash != skill.Hash {
					return nil, creationConflict("The skill was updated or is unavailable; retry")
				}
				if args.Path == cloudAgentSkillEntryPath {
					return cloudAgentSkillPage(skill.Version, args.Path, detail.Instruction, args.Offset)
				}
				if _, ok := skill.Files[args.Path]; !ok {
					return nil, BadAuthRequest("The reference file is not in this run's fixed snapshot")
				}
				file, err := service.SkillPackageFile(userID, skill.ID, args.Path)
				if err != nil {
					return nil, err
				}
				if file.Binary {
					return nil, BadAuthRequest("Binary skill files cannot be read")
				}
				latest, err := service.SkillDetail(userID, skill.ID)
				if err != nil {
					return nil, err
				}
				if !latest.IsAdded || latest.Status != 1 || latest.VersionID != skill.Version || latest.ContentHash != skill.Hash {
					return nil, creationConflict("The skill was updated or is unavailable; retry")
				}
				return cloudAgentSkillPage(skill.Version, args.Path, file.Content, args.Offset)
			}
			if args.Path == cloudAgentSkillEntryPath && strings.TrimSpace(skill.Instruction) != "" {
				return map[string]any{"version": skill.Version, "path": args.Path, "content": skill.Instruction}, nil
			}
			if content, ok := skill.Files[args.Path]; ok && content != "" {
				return map[string]any{"version": skill.Version, "path": args.Path, "content": content}, nil
			}
			return nil, BadAuthRequest(fmt.Sprintf("The reference file is not in this run's fixed snapshot; readable paths: %s. Do not retry this path", strings.Join(cloudAgentSkillPaths(skill), ", ")))
		}
	}
	return nil, BadAuthRequest("The skill is not enabled in this run, or the reference file is not in the fixed snapshot")
}

func cloudAgentHandleTaskGet(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.TaskGetArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	task, err := repo.TaskForUser(userID, args.TaskID)
	if err != nil {
		return nil, err
	}
	if task.ProjectID != state.Request.CanvasID {
		return nil, BadAuthRequest("Tasks of other canvases cannot be read")
	}
	result := cloudAgentTaskDiagnostic(repo, task)
	result["status"] = task.Status
	result["text"] = truncateRunes(taskResultText(task.ResultJSON), 4000)
	return result, nil
}
