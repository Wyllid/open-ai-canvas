// 画布 Agent 的画布写操作：把工具参数转换成画布操作（增删节点、连线）并校验。
//
// 连线必须满足节点类型的输入约束（validateCloudAgentConnection），不合法的连线
// 直接拒绝并返回可读原因，由模型自行修正。

package app

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/repository"
)

func cloudAgentSkillPage(version, path, content string, offset int) (any, error) {
	runes := []rune(content)
	if offset < 0 || offset > len(runes) {
		return nil, BadAuthRequest("The skill read offset is beyond the end of the file")
	}
	end := offset + min(12000, len(runes)-offset)
	return map[string]any{"version": version, "path": path, "content": string(runes[offset:end]), "offset": offset, "nextOffset": end, "hasMore": end < len(runes)}, nil
}

func validateCloudAgentID(value, label string, maxRunes int) error {
	if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return BadAuthRequest(label + " must not be empty or have leading/trailing whitespace or invalid characters")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s must not exceed %d characters", label, maxRunes))
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return BadAuthRequest(label + " must not contain control characters")
		}
	}
	return nil
}

// validateCloudAgentVideoFramePatch 校验视频帧选择是否来自当前画布的图片输入。
// node 是修改后的节点，nodes 和 edges 是当前操作计划；patch 未修改帧时不影响旧节点。
// 空字符串允许取消选择；非空值必须先建立图片引用连线，实际素材可用性仍由生成准入校验。
func validateCloudAgentVideoFramePatch(node map[string]any, nodes, edges []map[string]any, patch map[string]any) error {
	for _, key := range []string{"videoStartFrameNodeId", "videoEndFrameNodeId"} {
		raw, changed := patch[key]
		if !changed {
			continue
		}
		id := stringValue(raw)
		if id == "" {
			continue
		}
		if err := validateCloudAgentID(id, "First/last frame image node ID", 80); err != nil {
			return cloudAgentFieldError("patch."+key, "invalid_value", cloudAgentSafeToolError(err))
		}
		frame := cloudAgentNodeByID(nodes, id)
		connected := false
		for _, edge := range edges {
			if stringValue(edge["fromNodeId"]) == id && stringValue(edge["toNodeId"]) == stringValue(node["id"]) {
				connected = true
				break
			}
		}
		if frame == nil || stringValue(frame["type"]) != "image" || !connected {
			return cloudAgentFieldError("patch."+key, "invalid_value", "First and last frames must be images connected to this video node; create the reference edge first")
		}
	}
	return nil
}

type agentCanvasArgs struct {
	SnapshotHash string          `json:"snapshotHash"`
	Ops          []agentCanvasOp `json:"ops"`
}

type agentCanvasOp struct {
	Type     string         `json:"type"`
	ID       string         `json:"id"`
	NodeType string         `json:"nodeType"`
	Title    *string        `json:"title"`
	Content  *string        `json:"content"`
	Patch    map[string]any `json:"patch"`
	// X/Y 为指针：nil 表示模型没有指定坐标，服务端按画布内容自动落位（不再落到原点重叠）。
	// 指针语义与 canvas/capability/builtin.go 的 positionPatchFields 一致（坐标是可选的数字）。
	X            *float64 `json:"x"`
	Y            *float64 `json:"y"`
	FromNodeID   string   `json:"fromNodeId"`
	ToNodeID     string   `json:"toNodeId"`
	FromHandleID string   `json:"fromHandleId"`
	ToHandleID   string   `json:"toHandleId"`
}

// Explicit node creation and edges only; no generic metadata, media URL or deletion.
func applyCloudAgentCanvas(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentCanvasMutation(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if err = saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	appliedPreview := cloudAgentCanvasAppliedPreview(plan.Preview)
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{
			UserID:             userID,
			CanvasID:           canvasID,
			StepID:             call.ID,
			Operation:          "canvas_apply_ops",
			BeforeSnapshotHash: plan.BeforeSnapshotHash,
			AfterSnapshotHash:  cloudAgentCanvasHash(plan.Document),
			BeforeJSON:         plan.BeforeJSON,
			Preview:            &appliedPreview,
		}); err != nil {
			return nil, err
		}
	}
	return map[string]any{"canvasId": canvasID, "snapshotHash": cloudAgentCanvasHash(plan.Document), "committed": true, "summary": fmt.Sprintf("Completed %d node/edge operations", len(plan.Args.Ops)), "preview": appliedPreview}, nil
}

func validateCloudAgentConnection(nodes []map[string]any, fromID, toID string, existingConnections ...[]map[string]any) error {
	return validateCloudAgentConnectionWithHandles(nodes, fromID, toID, "", "", existingConnections...)
}

func validateCloudAgentConnectionWithHandles(nodes []map[string]any, fromID, toID, fromHandleID, toHandleID string, existingConnections ...[]map[string]any) error {
	if err := validateCloudAgentID(fromID, "Source node ID", 80); err != nil {
		return err
	}
	if err := validateCloudAgentID(toID, "Target node ID", 80); err != nil {
		return err
	}
	if fromID == toID {
		return BadAuthRequest("An edge cannot point to its own node")
	}
	var from, to map[string]any
	for _, node := range nodes {
		if stringValue(node["id"]) == fromID {
			from = node
		}
		if stringValue(node["id"]) == toID {
			to = node
		}
	}
	if from == nil || to == nil {
		return BadAuthRequest("The edge endpoint does not exist")
	}
	if err := validateCloudAgentStoryboardHandle(from, fromHandleID, "source"); err != nil {
		return err
	}
	if err := validateCloudAgentStoryboardHandle(to, toHandleID, "target"); err != nil {
		return err
	}
	fromCapability, fromKnown := cloudAgentNodeCapabilityForNode(from)
	toCapability, toKnown := cloudAgentNodeCapabilityForNode(to)
	if !fromKnown || !toKnown {
		return BadAuthRequest("The edge involves a node type the Agent does not support")
	}
	fromKind := fromCapability.InputKind
	if fromKind == "" || !fromCapability.Connection.CanSource {
		return BadAuthRequest(fmt.Sprintf("Source node type %s cannot be a generation input; reference edges are not for linking ordinary nodes", fromCapability.Type))
	}
	if !toCapability.Connection.CanTarget {
		return BadAuthRequest(fmt.Sprintf("Target node type %s cannot receive generation input; no reference edge is needed to file documents", toCapability.Type))
	}
	connections := []map[string]any{}
	if len(existingConnections) > 0 {
		connections = existingConnections[0]
	}
	for _, edge := range connections {
		if stringValue(edge["toNodeId"]) == toID && stringValue(edge["fromNodeId"]) == fromID && stringValue(edge["fromHandleId"]) == fromHandleID && stringValue(edge["toHandleId"]) == toHandleID {
			return BadAuthRequest("Duplicate edge")
		}
	}
	if err := toCapability.ValidateConnection(fromKind); err != nil {
		return BadAuthRequest(err.Error())
	}
	if maxInputs := toCapability.Connection.MaxInputCount; maxInputs > 0 {
		inputIDs := map[string]bool{}
		for _, edge := range connections {
			if stringValue(edge["toNodeId"]) == toID {
				inputIDs[stringValue(edge["fromNodeId"])] = true
			}
		}
		inputIDs[fromID] = true
		if len(inputIDs) > maxInputs {
			return BadAuthRequest(fmt.Sprintf("%s accepts at most %d inputs", toCapability.Label, maxInputs))
		}
	}
	return nil
}

// validateCloudAgentStoryboardHandle 校验 handle 所属端点和真实镜头行，返回可修正的具体字段。
// 资产引用与镜头输出方向不同，只给出纠正说明，不自动交换端点或迁移 handle。
func validateCloudAgentStoryboardHandle(node map[string]any, handleID, side string) error {
	if handleID == "" {
		return nil
	}
	field := "toHandleId"
	if side == "source" {
		field = "fromHandleId"
	}
	if stringValue(node["type"]) != "script" {
		message := "toHandleId is only allowed on a storyboard target node; to pick a shot output, connect storyboard → image/video and put row:<real rowId> in the storyboard source's fromHandleId"
		if side == "source" {
			message = "fromHandleId is only allowed on a storyboard source node; to bind an asset to a shot row, connect asset → storyboard, omit fromHandleId and put row:<real rowId> in the storyboard target's toHandleId"
		}
		return cloudAgentFieldError(field, "invalid_node_handle", message)
	}
	if handleID == "storyboard:context" {
		return nil
	}
	if !strings.HasPrefix(handleID, "row:") || strings.TrimSpace(strings.TrimPrefix(handleID, "row:")) == "" {
		return cloudAgentFieldError(field, "invalid_handle", field+" must be row:<real rowId> or storyboard:context; a shot number is not a rowId, so read the storyboard first")
	}
	metadata, _ := node["metadata"].(map[string]any)
	storyboard, _ := metadata["storyboard"].(map[string]any)
	rowID := strings.TrimPrefix(handleID, "row:")
	for _, row := range creationMaps(storyboard["rows"]) {
		if stringValue(row["id"]) == rowID {
			return nil
		}
	}
	return cloudAgentFieldError(field, "not_found", field+" references a rowId that does not exist; read the latest real row IDs with canvas_read_storyboard instead of using shot numbers")
}

func cloudAgentInputKindLabel(kind string) string {
	switch kind {
	case "image":
		return "image"
	case "video":
		return "video"
	case "audio":
		return "audio"
	default:
		return "text"
	}
}

func creationMaps(value any) []map[string]any {
	result := []map[string]any{}
	switch items := value.(type) {
	case []any:
		for _, v := range items {
			if m, ok := v.(map[string]any); ok {
				result = append(result, m)
			}
		}
	case []map[string]any:
		result = items
	}
	return result
}

// Only server-registered canvas capabilities are exposed to the model. UI-only
// renderers are not a persistence or authorization contract.
func cloudAgentNodeTypes() map[string]any {
	types := make([]map[string]any, 0, len(canvasCapabilityRegistry.List()))
	for _, capability := range canvasCapabilityRegistry.List() {
		item := map[string]any{
			"type":        capability.Type,
			"label":       capability.Label,
			"purpose":     capability.Purpose,
			"defaultSize": map[string]any{"width": capability.DefaultWidth, "height": capability.DefaultHeight},
			"canUpdate":   capability.CanUpdate,
		}
		if variant := capability.Variant; variant != nil {
			// 变体不能 add_node；画布里按 type+metadata.workflowKind 识别，读取结果以 kind 标出。
			item["canvasNodeType"], item["workflowKind"], item["creatable"] = variant.BaseType, variant.WorkflowKind, false
		}
		if len(capability.GoodFor) > 0 {
			item["goodFor"] = capability.GoodFor
		}
		if len(capability.NotIdealFor) > 0 {
			item["notIdealFor"] = capability.NotIdealFor
		}
		if len(capability.Tradeoffs) > 0 {
			item["tradeoffs"] = capability.Tradeoffs
		}
		if len(capability.Actions) > 0 {
			item["actions"] = capability.Actions
		}
		if capability.CanUpdate {
			fields := map[string]any{}
			for key, field := range capability.PatchFields {
				definition := map[string]any{"type": field.Kind, "label": field.Label, "displayOrder": field.Order, "maxCharacters": field.MaxRunes}
				if field.Description != "" {
					definition["description"] = field.Description
				}
				fields[key] = definition
			}
			item["updateFields"] = fields
		}
		if capability.InputKind != "" {
			item["inputKind"] = capability.InputKind
		}
		if capability.GenerationMode != "" && cloudAgentGenerationModeSupported(capability.GenerationMode) {
			item["generationMode"] = capability.GenerationMode
		}
		if len(capability.Connection.AcceptedInputKinds) > 0 {
			item["acceptedInputKinds"] = capability.Connection.AcceptedInputKinds
		}
		if len(capability.Connection.RejectedInputKinds) > 0 {
			item["rejectedInputKinds"] = capability.Connection.RejectedInputKinds
		}
		if capability.Connection.MaxInputCount > 0 {
			item["maxInputCount"] = capability.Connection.MaxInputCount
		}
		item["canSource"] = capability.Connection.CanSource
		item["canTarget"] = capability.Connection.CanTarget
		item["canReference"] = capability.Connection.CanReference
		types = append(types, item)
	}
	return map[string]any{"schemaVersion": 2, "nodes": types, "selectionGuide": []string{
		"For a single image, a one-off prompt or a quick experiment, text/Markdown and media nodes are usually lighter.",
		"For multiple shots, continuity, shot-by-shot review or generation, or later maintenance, a storyboard is usually a better fit.",
		"A media node holds a single generation target and does not replace a multi-shot structure; after choosing a media node, filter models with model_list by generation mode and this request's real reference nodes.",
		"The Agent chooses node types from the user's goal; do not create complex nodes for form's sake, and do not pass plain text off as a structured storyboard.",
	}}
}
