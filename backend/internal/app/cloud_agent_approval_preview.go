package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/canvas/capability"
	"yingce/backend/internal/canvas/layout"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// cloudAgentApprovalPreview is server-authored explanatory data. It never
// grants capabilities: execution still validates the original call, snapshot,
// ownership, node registry, locks and budget after approval.
type cloudAgentApprovalPreview struct {
	Kind        string                          `json:"kind"`
	Status      string                          `json:"status,omitempty"`
	Title       string                          `json:"title"`
	Description string                          `json:"description"`
	Items       []cloudAgentApprovalPreviewItem `json:"items"`
}

type cloudAgentApprovalPreviewItem struct {
	Operation       string   `json:"operation"`
	NodeID          string   `json:"nodeId,omitempty"`
	NodeTitle       string   `json:"nodeTitle,omitempty"`
	ResultTitle     string   `json:"resultTitle,omitempty"`
	NodeType        string   `json:"nodeType,omitempty"`
	NodeTypeLabel   string   `json:"nodeTypeLabel,omitempty"`
	TargetNodeID    string   `json:"targetNodeId,omitempty"`
	TargetNodeTitle string   `json:"targetNodeTitle,omitempty"`
	TargetNodeType  string   `json:"targetNodeType,omitempty"`
	Fields          []string `json:"fields,omitempty"`
	Details         []string `json:"details,omitempty"`
	Summary         string   `json:"summary"`
}

type cloudAgentCanvasMutationPlan struct {
	Args               agentCanvasArgs
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	Preview            cloudAgentApprovalPreview
}

// prepareCloudAgentCanvasMutation is the single dry-run and execution planner.
// Approval previews and the eventual write therefore share the exact same
// parser, snapshot check and capability validation instead of drifting apart.
func prepareCloudAgentCanvasMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentCanvasMutationPlan, error) {
	args, err := decodeCloudAgentCanvasArgs(call.Function.Arguments)
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
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.SnapshotHash {
		// The tool call describes concrete node/connection operations. Rebase that
		// operation list onto the current document instead of rejecting it because
		// an unrelated browser save advanced the canvas revision.
		latest, latestErr := repo.CanvasProjectForUser(userID, canvasID)
		if latestErr != nil {
			return nil, latestErr
		}
		canvas = latest
		doc, err = creationDocument(canvas.PayloadJSON)
		if err != nil {
			return nil, err
		}
		beforeHash = cloudAgentCanvasHash(doc)
	}
	items, err := applyCloudAgentCanvasPlan(doc, args.Ops)
	if err != nil {
		return nil, err
	}
	return &cloudAgentCanvasMutationPlan{
		Args:               args,
		Canvas:             canvas,
		Document:           doc,
		BeforeJSON:         canvas.PayloadJSON,
		BeforeSnapshotHash: beforeHash,
		Preview:            cloudAgentCanvasApprovalPreview(items),
	}, nil
}

func applyCloudAgentCanvasPlan(doc map[string]any, ops []agentCanvasOp) ([]cloudAgentApprovalPreviewItem, error) {
	nodes := creationMaps(doc["nodes"])
	edges := creationMaps(doc["connections"])
	items := make([]cloudAgentApprovalPreviewItem, 0, len(ops))
	for opIndex, op := range ops {
		title, content := "", ""
		if op.Title != nil {
			title = *op.Title
		}
		if op.Content != nil {
			content = *op.Content
		}
		if err := validateCloudAgentID(op.ID, "Node or edge ID", 80); err != nil {
			return nil, err
		}
		if op.Type == "add_node" && (utf8.RuneCountInString(content) > 16000 || utf8.RuneCountInString(title) > 240) {
			return nil, BadAuthRequest("Node title or body exceeds the limit")
		}
		index := cloudAgentNodeIndex(nodes, op.ID)
		switch op.Type {
		case "add_node":
			if index >= 0 {
				return nil, BadAuthRequest("Duplicate new node ID")
			}
			capability, ok := cloudAgentNodeCapabilityForType(op.NodeType)
			if strings.TrimSpace(op.NodeType) == "" {
				return nil, BadAuthRequest("New node is missing nodeType")
			}
			if !ok {
				return nil, BadAuthRequest("Unsupported node type")
			}
			x, y := op.X, op.Y
			if x == nil || y == nil {
				// 没有（完整）坐标时不落到原点：按泳道与依赖关系算一个空位，
				// 保证同一批新增的多个节点也不会互相重叠。模型只给了一个轴时保留它。
				pending := cloudAgentLayoutNodes(map[string]any{"nodes": nodes})
				var hint *layout.Position
				if x != nil || y != nil {
					hint = &layout.Position{}
					if x != nil {
						hint.X = *x
					}
					if y != nil {
						hint.Y = *y
					}
				}
				if slot, ok := cloudAgentArrangeAddNodePosition(doc, pending, op, ops, hint); ok {
					if x == nil {
						value := slot.X
						x = &value
					}
					if y == nil {
						value := slot.Y
						y = &value
					}
				}
			}
			node := creationAddedNode(CreationCanvasOp{Type: op.Type, ID: op.ID, NodeType: op.NodeType, Title: title, X: x, Y: y, Metadata: capability.Metadata(content)})
			nodes = append(nodes, node)
			nodeTitle := cloudAgentApprovalNodeTitle(node, capability.Label)
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "add_node", NodeID: op.ID, NodeTitle: nodeTitle,
				NodeType: capability.Type, NodeTypeLabel: capability.Label,
				Summary: fmt.Sprintf("Add %s '%s'", capability.Label, nodeTitle),
			})
		case "connect_nodes":
			if err := validateCloudAgentID(op.FromNodeID, "Source node ID", 80); err != nil {
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].fromNodeId", opIndex), "invalid_value", cloudAgentSafeToolError(err))
			}
			if err := validateCloudAgentID(op.ToNodeID, "Target node ID", 80); err != nil {
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].toNodeId", opIndex), "invalid_value", cloudAgentSafeToolError(err))
			}
			fromIndex, toIndex := cloudAgentNodeIndex(nodes, op.FromNodeID), cloudAgentNodeIndex(nodes, op.ToNodeID)
			switch {
			case fromIndex < 0:
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].fromNodeId", opIndex), "not_found", "The edge source node is not on this canvas; read the canvas again and use a real node ID")
			case toIndex < 0:
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].toNodeId", opIndex), "not_found", "The edge target node is not on this canvas; read the canvas again and use a real node ID")
			case op.FromNodeID == op.ToNodeID:
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].toNodeId", opIndex), "invalid_value", "An edge cannot point to its own node; choose another target node")
			}
			if err := validateCloudAgentConnectionWithHandles(nodes, op.FromNodeID, op.ToNodeID, op.FromHandleID, op.ToHandleID, edges); err != nil {
				// 保留端点校验指出的具体字段，让模型只修正错误 handle，而不是放弃镜头绑定。
				var fieldErr *cloudAgentFieldArgumentError
				if errors.As(err, &fieldErr) {
					return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].%s", opIndex, fieldErr.Field), fieldErr.Issue, cloudAgentSafeToolError(err))
				}
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d]", opIndex), "invalid_connection", cloudAgentSafeToolError(err))
			}
			for _, edge := range edges {
				if stringValue(edge["id"]) == op.ID {
					return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].id", opIndex), "duplicate", "Edge ID already exists; give the new edge an unused ID")
				}
				if stringValue(edge["fromNodeId"]) == op.FromNodeID && stringValue(edge["toNodeId"]) == op.ToNodeID && stringValue(edge["fromHandleId"]) == op.FromHandleID && stringValue(edge["toHandleId"]) == op.ToHandleID {
					return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d]", opIndex), "duplicate", "These two nodes and handles are already connected; remove the duplicate operation")
				}
			}
			fromCapability, _ := cloudAgentNodeCapabilityForNode(nodes[fromIndex])
			toCapability, _ := cloudAgentNodeCapabilityForNode(nodes[toIndex])
			fromTitle := cloudAgentApprovalNodeTitle(nodes[fromIndex], fromCapability.Label)
			toTitle := cloudAgentApprovalNodeTitle(nodes[toIndex], toCapability.Label)
			edge := map[string]any{"id": op.ID, "fromNodeId": op.FromNodeID, "toNodeId": op.ToNodeID}
			if op.FromHandleID != "" {
				edge["fromHandleId"] = op.FromHandleID
			}
			if op.ToHandleID != "" {
				edge["toHandleId"] = op.ToHandleID
			}
			edges = append(edges, edge)
			if err := applyCloudAgentStoryboardConnection(nodes, op.FromNodeID, op.ToNodeID, op.FromHandleID, op.ToHandleID); err != nil {
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d]", opIndex), "invalid_connection", cloudAgentSafeToolError(err))
			}
			details := cloudAgentStoryboardConnectionDetails(op.FromHandleID, op.ToHandleID)
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "connect_nodes", NodeID: op.FromNodeID, NodeTitle: fromTitle,
				NodeType: fromCapability.Type, NodeTypeLabel: fromCapability.Label,
				TargetNodeID: op.ToNodeID, TargetNodeTitle: toTitle, TargetNodeType: toCapability.Type,
				Details: details,
				Summary: fmt.Sprintf("Connect '%s' → '%s' as a reference", fromTitle, toTitle),
			})
		case "update_node":
			if len(op.Patch) == 0 {
				// 漏字段是模型照 schema 就能自己修好的参数错误：当成工具结果回给它重试，
				// 而不是判整轮失败（用户只在失败提示里看到一句"patch is required"）。
				// 未知操作类型仍按准入失败终止（cloud_agent_test.go 有用例断言这一行为）。
				return nil, &cloudAgentArgumentError{BadAuthRequest("Updating a node requires a patch")}
			}
			if index < 0 {
				// 节点 ID 不存在同样是模型可自行纠正的参数错误，与连线端点 not_found 一致。
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d].id", opIndex), "not_found", "Only existing nodes supported by the Agent can be updated; this node is not on the current canvas, so read the canvas again and use a real node ID")
			}
			capability, ok := cloudAgentNodeCapabilityForNode(nodes[index])
			if !ok || !capability.CanUpdate {
				return nil, BadAuthRequest("This node type cannot be updated by the Agent")
			}
			metadata, _ := nodes[index]["metadata"].(map[string]any)
			if metadata["locked"] == true {
				return nil, BadAuthRequest("Locked nodes cannot be changed")
			}
			beforeTitle := cloudAgentApprovalNodeTitle(nodes[index], capability.Label)
			fields := cloudAgentApprovalPatchLabels(capability.PatchFields, op.Patch)
			if err := capability.ApplyPatch(nodes[index], op.Patch); err != nil {
				return nil, BadAuthRequest(err.Error())
			}
			if err := validateCloudAgentVideoFramePatch(nodes[index], nodes, edges, op.Patch); err != nil {
				return nil, err
			}
			afterTitle := cloudAgentApprovalNodeTitle(nodes[index], capability.Label)
			resultTitle := ""
			if afterTitle != beforeTitle {
				resultTitle = afterTitle
			}
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "update_node", NodeID: op.ID, NodeTitle: beforeTitle, ResultTitle: resultTitle,
				NodeType: capability.Type, NodeTypeLabel: capability.Label, Fields: fields,
				Summary: fmt.Sprintf("Change %[3]s of %[1]s '%[2]s'", capability.Label, beforeTitle, strings.Join(fields, ", ")),
			})
		default:
			return nil, BadAuthRequest("Unsupported canvas write operation")
		}
	}
	doc["nodes"] = nodes
	doc["connections"] = edges
	return items, nil
}

func applyCloudAgentStoryboardConnection(nodes []map[string]any, fromNodeID, toNodeID, fromHandleID, toHandleID string) error {
	if fromHandleID == "" && toHandleID == "" {
		return nil
	}
	from := cloudAgentNodeByID(nodes, fromNodeID)
	to := cloudAgentNodeByID(nodes, toNodeID)
	if from == nil || to == nil {
		return BadAuthRequest("Storyboard edge endpoint does not exist")
	}
	scriptNode, linkedNode, handleID := from, to, fromHandleID
	scriptIsSource := true
	if handleID == "" {
		scriptNode, linkedNode, handleID = to, from, toHandleID
		scriptIsSource = false
	}
	if stringValue(scriptNode["type"]) != "script" {
		return BadAuthRequest("A storyboard handle must be on a storyboard node")
	}
	metadata, ok := scriptNode["metadata"].(map[string]any)
	if !ok {
		return BadAuthRequest("Invalid storyboard node data format")
	}
	storyboard, ok := metadata["storyboard"].(map[string]any)
	if !ok {
		return BadAuthRequest("The storyboard node has no structured table")
	}
	if handleID == "storyboard:context" {
		ids := stringIDs(storyboard["referenceNodeIds"])
		linkedID := stringValue(linkedNode["id"])
		if linkedID != "" && !containsStoryboardString(ids, linkedID) {
			storyboard["referenceNodeIds"] = append(idsAsAny(ids), linkedID)
		}
		return nil
	}
	rowID := strings.TrimPrefix(handleID, "row:")
	var row map[string]any
	for _, candidate := range creationMaps(storyboard["rows"]) {
		if stringValue(candidate["id"]) == rowID {
			row = candidate
			break
		}
	}
	if row == nil {
		return BadAuthRequest("Storyboard row not found; read the latest storyboard row IDs first")
	}
	if scriptIsSource {
		switch stringValue(linkedNode["type"]) {
		case "image":
			row["imageNodeId"] = linkedNode["id"]
		case "video":
			row["videoNodeId"] = linkedNode["id"]
		}
		return nil
	}
	binding, ok := cloudAgentStoryboardBinding(linkedNode)
	if !ok {
		return nil
	}
	bindings := creationMaps(row["assetBindings"])
	for _, existing := range bindings {
		if stringValue(existing["nodeId"]) == stringValue(linkedNode["id"]) {
			return nil
		}
	}
	row["assetBindings"] = append(bindingsAsAny(bindings), binding)
	return nil
}

func cloudAgentStoryboardConnectionDetails(fromHandleID, toHandleID string) []string {
	handleID := fromHandleID
	if handleID == "" {
		handleID = toHandleID
	}
	if handleID == "storyboard:context" {
		return []string{"Attach to the storyboard global settings"}
	}
	if strings.HasPrefix(handleID, "row:") {
		return []string{fmt.Sprintf("Attach to shot row %s", strings.TrimPrefix(handleID, "row:"))}
	}
	return nil
}

func cloudAgentStoryboardBinding(node map[string]any) (map[string]any, bool) {
	metadata, _ := node["metadata"].(map[string]any)
	role := ""
	switch {
	case stringValue(metadata["workflowKind"]) == "character" || stringValue(metadata["assetCategory"]) == "character":
		role = "character"
	case stringValue(node["type"]) == "audio":
		role = "audio"
	case stringValue(node["type"]) == "video":
		role = "motion"
	case stringValue(metadata["assetCategory"]) == "environment":
		role = "environment"
	case stringValue(metadata["assetCategory"]) == "prop":
		role = "prop"
	case stringValue(node["type"]) == "image":
		role = "style"
	}
	if role == "" || stringValue(node["id"]) == "" {
		return nil, false
	}
	priority := 60
	switch role {
	case "character":
		priority = 100
	case "environment":
		priority = 90
	case "prop", "wardrobe", "weapon":
		priority = 80
	case "motion", "audio":
		priority = 70
	}
	return map[string]any{"nodeId": node["id"], "role": role, "priority": float64(priority)}, true
}

func cloudAgentNodeByID(nodes []map[string]any, id string) map[string]any {
	for _, node := range nodes {
		if stringValue(node["id"]) == id {
			return node
		}
	}
	return nil
}

func stringIDs(value any) []string {
	values, _ := value.([]any)
	ids := make([]string, 0, len(values))
	for _, item := range values {
		if id := stringValue(item); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func idsAsAny(values []string) []any {
	out := make([]any, len(values))
	for index, value := range values {
		out[index] = value
	}
	return out
}

func bindingsAsAny(values []map[string]any) []any {
	out := make([]any, len(values))
	for index, value := range values {
		out[index] = value
	}
	return out
}

func containsStoryboardString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func cloudAgentCanvasAppliedPreview(preview cloudAgentApprovalPreview) cloudAgentApprovalPreview {
	applied := preview
	counts := map[string]int{}
	for _, item := range preview.Items {
		counts[item.Operation]++
	}
	parts := make([]string, 0, 3)
	if counts["add_node"] > 0 {
		parts = append(parts, fmt.Sprintf("add %d nodes", counts["add_node"]))
	}
	if counts["update_node"] > 0 {
		parts = append(parts, fmt.Sprintf("change %d nodes", counts["update_node"]))
	}
	if counts["connect_nodes"] > 0 {
		parts = append(parts, fmt.Sprintf("create %d reference edges", counts["connect_nodes"]))
	}
	if len(parts) == 0 {
		for _, item := range preview.Items {
			if summary := strings.TrimSpace(item.Summary); summary != "" {
				parts = append(parts, summary)
			}
		}
	}
	if len(parts) == 0 {
		parts = append(parts, "the requested canvas operations")
	}
	applied.Status = "applied"
	applied.Title = "Canvas changes written"
	applied.Description = fmt.Sprintf("Canvas changes written: %s.", strings.Join(parts, ", "))
	return applied
}

func cloudAgentMediaSubmittedPreview(preview cloudAgentApprovalPreview) cloudAgentApprovalPreview {
	preview.Status = "submitted"
	preview.Title = "Generation task submitted"
	summary := "media generation task"
	if len(preview.Items) > 0 && strings.TrimSpace(preview.Items[0].Summary) != "" {
		summary = preview.Items[0].Summary
	}
	preview.Description = fmt.Sprintf("Generation task submitted: %s. The result is not ready yet; it is written back to the canvas when it finishes.", summary)
	return preview
}

func cloudAgentCanvasApprovalPreview(items []cloudAgentApprovalPreviewItem) cloudAgentApprovalPreview {
	counts := map[string]int{}
	for _, item := range items {
		counts[item.Operation]++
	}
	parts := make([]string, 0, 3)
	if counts["add_node"] > 0 {
		parts = append(parts, fmt.Sprintf("add %d nodes", counts["add_node"]))
	}
	if counts["update_node"] > 0 {
		parts = append(parts, fmt.Sprintf("change %d nodes", counts["update_node"]))
	}
	if counts["connect_nodes"] > 0 {
		parts = append(parts, fmt.Sprintf("create %d reference edges", counts["connect_nodes"]))
	}
	return cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "Confirm canvas changes",
		Description: fmt.Sprintf("The Agent is about to %s. Check the target nodes and changed fields; nothing is written to the canvas until you approve.", strings.Join(parts, ", ")),
		Items:       items,
	}
}

func cloudAgentMediaApprovalPreview(plan *cloudAgentMediaPlan, modelName string) cloudAgentApprovalPreview {
	args := plan.Args
	descriptor, _ := cloudAgentNodeCapabilityForGenerationMode(args.Mode)
	nodeTitle := truncateRunes(strings.TrimSpace(args.Title), 120)
	if nodeTitle == "" {
		nodeTitle = "Untitled " + descriptor.Label
	}
	details := make([]string, 0, 6)
	if modelName != "" {
		details = append(details, "Model: "+truncateRunes(modelName, 120))
	}
	if len(args.ReferenceNodeIDs) > 0 {
		details = append(details, fmt.Sprintf("References %d canvas assets and connects them", len(args.ReferenceNodeIDs)))
	} else {
		details = append(details, "No canvas media assets referenced")
	}
	if len(args.CharacterLabels) > 0 {
		details = append(details, "Character cards: "+truncateRunes(strings.Join(args.CharacterLabels, ", "), 200))
	}
	if args.Duration > 0 {
		details = append(details, fmt.Sprintf("Duration: %d s", args.Duration))
	}
	if args.Size != "" {
		details = append(details, "Aspect ratio: "+truncateRunes(args.Size, 40))
	}
	if args.VideoStartFrameNodeID != "" {
		details = append(details, "First frame node: "+truncateRunes(args.VideoStartFrameNodeID, 80))
	}
	if args.VideoEndFrameNodeID != "" {
		details = append(details, "Last frame node: "+truncateRunes(args.VideoEndFrameNodeID, 80))
	}
	if args.Quality != "" {
		details = append(details, "Quality: "+truncateRunes(args.Quality, 40))
	}
	if args.ImageResolution != "" {
		details = append(details, "Resolution: "+truncateRunes(args.ImageResolution, 40))
	}
	if args.ConfigurationChange != nil {
		details = append(details, "Reason for the specification change: "+truncateRunes(args.ConfigurationChange.UserInstruction, 200))
	}
	if args.VideoGenerateAudio != nil {
		value := "off"
		if *args.VideoGenerateAudio {
			value = "on"
		}
		details = append(details, "Audio: "+value)
	}
	return cloudAgentApprovalPreview{
		Kind: "media_generation", Title: "Confirm " + strings.ToLower(descriptor.Label) + " generation",
		Description: descriptor.Label + " draft node and reference edges were created; nothing has been submitted yet. Approving after checking the specification submits the paid task, and the result is written back to the canvas automatically; rejecting keeps the draft.",
		Items: []cloudAgentApprovalPreviewItem{{
			Operation: "generate_media", NodeID: args.NodeID, NodeTitle: nodeTitle,
			NodeType: descriptor.Type, NodeTypeLabel: descriptor.Label, Details: details,
			Summary: "Generate " + strings.ToLower(descriptor.Label) + " '" + nodeTitle + "'",
		}},
	}
}

func cloudAgentApprovalPatchLabels(fields map[string]capability.PatchField, patch map[string]any) []string {
	keys := make([]string, 0, len(patch))
	for key := range patch {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := fields[keys[i]], fields[keys[j]]
		if left.Order != right.Order {
			return left.Order < right.Order
		}
		return keys[i] < keys[j]
	})
	labels := make([]string, 0, len(keys))
	for _, key := range keys {
		if field, ok := fields[key]; ok {
			labels = append(labels, field.Label)
		}
	}
	return labels
}

func cloudAgentNodeIndex(nodes []map[string]any, id string) int {
	for index, node := range nodes {
		if stringValue(node["id"]) == id {
			return index
		}
	}
	return -1
}

func cloudAgentApprovalNodeTitle(node map[string]any, typeLabel string) string {
	title := truncateRunes(strings.TrimSpace(stringValue(node["title"])), 120)
	if title != "" {
		return title
	}
	return "Untitled " + typeLabel
}

func cloudAgentApprovalCallHash(call cloudAgentCall) string {
	// Tool-call IDs are transport metadata and may be regenerated when the
	// model retries the same approved operation. Hash only the operation
	// payload so approval survives a retry with a different call ID. A media
	// snapshot hash is also a concurrency hint, not generation input: the
	// server revalidates the prepared dependency hash below, which deliberately
	// ignores layout-only edits such as moving a node.
	arguments := call.Function.Arguments
	if cloudAgentMediaTool(call.Function.Name) {
		var object map[string]any
		if err := json.Unmarshal([]byte(arguments), &object); err == nil {
			delete(object, "snapshotHash")
			if raw, err := json.Marshal(object); err == nil {
				arguments = string(raw)
			}
		}
	}
	payload := struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: call.Function.Name, Arguments: arguments}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
