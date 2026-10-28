package app

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/canvas/layout"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentCharacterNodeWidth  = 264.0
	cloudAgentCharacterNodeHeight = 352.0
)

// cloudAgentCharacterDefinitionArgs 是 Agent 可写的角色设定字段；未声明的字段会被拒绝。
type cloudAgentCharacterDefinitionArgs struct {
	Role              string   `json:"role"`
	Aliases           []string `json:"aliases"`
	Appearance        string   `json:"appearance"`
	Physique          string   `json:"physique"`
	Clothing          string   `json:"clothing"`
	Personality       string   `json:"personality"`
	Props             string   `json:"props"`
	ConsistencyPrompt string   `json:"consistencyPrompt"`
	MultiViewPrompt   string   `json:"multiViewPrompt"`
	VoiceLanguage     string   `json:"voiceLanguage"`
	VoiceAge          string   `json:"voiceAge"`
	VoiceTimbre       string   `json:"voiceTimbre"`
}

type cloudAgentCharacterCreateArgs struct {
	NodeID      string                            `json:"nodeId"`
	Name        string                            `json:"name"`
	ImageNodeID string                            `json:"imageNodeId"`
	AudioNodeID string                            `json:"audioNodeId"`
	Definition  cloudAgentCharacterDefinitionArgs `json:"definition"`
	X           *float64                          `json:"x"`
	Y           *float64                          `json:"y"`
}

type cloudAgentCharacterCreatePlan struct {
	Args            cloudAgentCharacterCreateArgs
	Definition      map[string]any
	ImageResourceID string
	AudioResourceID string
	VoiceName       string
	Position        layout.Position
	Preview         cloudAgentApprovalPreview
}

// 设定字段只在描述里列出键名以控制工具 schema 体积；解码时 DisallowUnknownFields 会拒绝未声明的键。
func cloudAgentCharacterCreateSchema() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	return map[string]any{
		"nodeId": str("New node ID"), "name": str("Character name"), "imageNodeId": str("ID of a ready look image node"), "audioNodeId": str("Optional ID of a ready voice audio node"),
		"definition": map[string]any{"type": "object", "description": "Optional profile: role/appearance/physique/clothing/personality/props/consistencyPrompt/multiViewPrompt/voiceLanguage/voiceAge/voiceTimbre are strings, aliases is a string array"},
		"x":          map[string]any{"type": "number"}, "y": map[string]any{"type": "number"},
	}
}

func cloudAgentCharacterText(value string, limit int) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > limit {
		return "", BadAuthRequest(fmt.Sprintf("Each character profile item must not exceed %d characters", limit))
	}
	return value, nil
}

func (d cloudAgentCharacterDefinitionArgs) normalized() (map[string]any, error) {
	result := map[string]any{}
	for key, value := range map[string]string{
		"role": d.Role, "appearance": d.Appearance, "physique": d.Physique, "clothing": d.Clothing,
		"personality": d.Personality, "props": d.Props, "consistencyPrompt": d.ConsistencyPrompt,
		"multiViewPrompt": d.MultiViewPrompt, "voiceLanguage": d.VoiceLanguage, "voiceAge": d.VoiceAge, "voiceTimbre": d.VoiceTimbre,
	} {
		text, err := cloudAgentCharacterText(value, 4000)
		if err != nil {
			return nil, err
		}
		if text != "" {
			result[key] = text
		}
	}
	if len(d.Aliases) > 16 {
		return nil, BadAuthRequest("At most 16 character aliases")
	}
	aliases := []string{}
	for _, alias := range d.Aliases {
		text, err := cloudAgentCharacterText(alias, 100)
		if err != nil {
			return nil, err
		}
		if text != "" {
			aliases = append(aliases, text)
		}
	}
	result["aliases"] = aliases
	return result, nil
}

// cloudAgentCharacterMediaResource 从画布节点取已上传且就绪的账号资源；只接受真实节点，不接受 URL。
func cloudAgentCharacterMediaResource(repo *repository.Repository, userID string, nodes map[string]map[string]any, nodeID, kind, label string) (string, map[string]any, error) {
	node := nodes[nodeID]
	if node == nil || stringValue(node["type"]) != kind {
		return "", nil, BadAuthRequest(label + " node is not on this canvas or has the wrong type")
	}
	meta, _ := node["metadata"].(map[string]any)
	key := stringValue(meta["storageKey"])
	if !strings.HasPrefix(key, "resource:") {
		return "", nil, BadAuthRequest(label + " is not saved in the account resource library yet and cannot be used for a character card")
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil || resource == nil || resource.Kind != kind || resource.Status != "ready" {
		return "", nil, BadAuthRequest(label + " resource does not exist, is not ready or has the wrong type")
	}
	if kind == "audio" && !isSupportedVoiceSampleMimeType(resource.MimeType) {
		return "", nil, BadAuthRequest("Unsupported voice audio format: use MP3, WAV, M4A/AAC, FLAC, OGG/Opus or WebM")
	}
	return resource.ID, node, nil
}

func prepareCloudAgentCharacterCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentCharacterCreatePlan, error) {
	var args cloudAgentCharacterCreateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Invalid character card arguments: only nodeId, name, imageNodeId, audioNodeId, definition, x and y are allowed")}
	}
	if err := validateCloudAgentID(args.NodeID, "Character card node ID", 80); err != nil {
		return nil, &cloudAgentArgumentError{err}
	}
	name, err := cloudAgentCharacterText(args.Name, 80)
	if err != nil || name == "" {
		return nil, &cloudAgentArgumentError{BadAuthRequest("The character name must not be empty or longer than 80 characters")}
	}
	if args.ImageNodeID == "" {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Creating a character card needs imageNodeId: first have a ready look/turnaround image node")}
	}
	definition, err := args.Definition.normalized()
	if err != nil {
		return nil, &cloudAgentArgumentError{err}
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
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
	if nodes[args.NodeID] != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("Character card node ID already exists; use a new ID")}
	}
	plan := &cloudAgentCharacterCreatePlan{Args: args, Definition: definition}
	plan.Args.Name = name
	imageID, imageNode, err := cloudAgentCharacterMediaResource(repo, userID, nodes, args.ImageNodeID, "image", "Look image")
	if err != nil {
		return nil, err
	}
	plan.ImageResourceID = imageID
	details := []string{"Look: '" + cloudAgentApprovalNodeTitle(imageNode, "Image") + "'"}
	if args.AudioNodeID != "" {
		audioID, audioNode, err := cloudAgentCharacterMediaResource(repo, userID, nodes, args.AudioNodeID, "audio", "Voice audio")
		if err != nil {
			return nil, err
		}
		plan.AudioResourceID = audioID
		plan.VoiceName = truncateRunes(strings.TrimSpace(stringValue(audioNode["title"])), 160)
		details = append(details, "Voice: '"+cloudAgentApprovalNodeTitle(audioNode, "Audio")+"'")
	}
	if len(definition) > 1 {
		details = append(details, fmt.Sprintf("%d profile items", len(definition)-1))
	}
	// 显式坐标按原样使用；否则落在形象图片右侧的空位，不叠在已有节点上。
	if args.X != nil && args.Y != nil {
		plan.Position = layout.Position{X: *args.X, Y: *args.Y}
	} else {
		occupied := cloudAgentLayoutNodes(doc)
		var preferred *layout.Position
		if image, ok := findLayoutNode(occupied, args.ImageNodeID); ok {
			preferred = &layout.Position{X: image.X + image.Width + layout.PlacementGap, Y: image.Y}
		}
		plan.Position = layout.FreeSlot(cloudAgentCharacterNodeWidth, cloudAgentCharacterNodeHeight, "text", occupied, preferred, layout.PlacementGap)
	}
	withAudio := ""
	if plan.AudioResourceID != "" {
		withAudio = " and audio"
	}
	plan.Preview = cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "Confirm character card creation",
		Description: fmt.Sprintf("The Agent is about to bundle the canvas image%s into character card '%s': it is saved to the account character library and a character card node is placed on the canvas. Nothing happens until you approve.", withAudio, name),
		Items:       []cloudAgentApprovalPreviewItem{{Operation: "create_character", NodeID: args.NodeID, NodeTitle: name, NodeType: "character", NodeTypeLabel: "Character card", Details: details, Summary: fmt.Sprintf("Create character card '%s'", name)}},
	}
	return plan, nil
}

func cloudAgentCharacterReferencePrompt(name string, definition map[string]any) string {
	parts := []string{"[Character card: " + name + "]"}
	for _, key := range []string{"role", "appearance", "physique", "clothing", "personality", "props", "consistencyPrompt"} {
		if value := strings.TrimSpace(stringValue(definition[key])); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "\n")
}

// applyCloudAgentCharacterCreate 在 Agent 检查点事务里建角色资产并放置角色卡节点；任一步失败整体回滚。
func applyCloudAgentCharacterCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentCharacterCreate(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	created, err := (&Service{repo: repo}).CreateCharacter(userID, CreateCharacterRequest{
		Name: plan.Args.Name, Definition: plan.Definition, ImageResourceID: plan.ImageResourceID,
		AudioResourceID: plan.AudioResourceID, VoiceName: plan.VoiceName,
	})
	if err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	beforeJSON, beforeHash := canvas.PayloadJSON, cloudAgentCanvasHash(doc)
	card := created.Character
	meta := map[string]any{
		"workflowKind": "character", "characterAssetId": created.Asset.ID, "assetId": created.Asset.ID,
		"characterVersionId": card.VersionID, "characterVersionPolicy": "current",
		"characterName": plan.Args.Name, "characterPrompt": cloudAgentCharacterReferencePrompt(plan.Args.Name, plan.Definition),
		"characterAliases": plan.Definition["aliases"], "characterDefinition": plan.Definition,
		"characterVisualStatus": card.VisualStatus, "characterVoiceStatus": card.VoiceStatus,
		"status": "success", "fontSize": float64(14),
	}
	if card.Voice != nil {
		meta["characterVoiceName"] = card.Voice.Profile.Name
	}
	node := map[string]any{
		"id": plan.Args.NodeID, "type": "text", "title": plan.Args.Name,
		"position": map[string]any{"x": plan.Position.X, "y": plan.Position.Y},
		"width":    cloudAgentCharacterNodeWidth, "height": cloudAgentCharacterNodeHeight, "metadata": meta,
	}
	doc["nodes"] = append(creationMaps(doc["nodes"]), node)
	if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
		return nil, err
	}
	appliedPreview := cloudAgentCanvasAppliedPreview(plan.Preview)
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: call.Function.Name, BeforeSnapshotHash: beforeHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), BeforeJSON: beforeJSON, Preview: &appliedPreview}); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"canvasId": canvasID, "nodeId": plan.Args.NodeID, "characterAssetId": created.Asset.ID, "versionId": card.VersionID,
		"visualStatus": card.VisualStatus, "voiceStatus": card.VoiceStatus, "snapshotHash": cloudAgentCanvasHash(doc),
		"summary": appliedPreview.Description, "preview": appliedPreview,
	}, nil
}
