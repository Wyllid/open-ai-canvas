package app

import (
	"fmt"
	"math"
	"strings"

	"yingce/backend/internal/canvas/layout"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 云端 Agent 的节点整理：模型只决定"整理哪些节点 / 怎么归类"，几何一律由服务端算。
// 一次整理的上限刻意保守：坐标批量改写比内容改写更容易让用户迷失，且审批卡要能一眼看完。
const (
	cloudAgentArrangeMaxNodes  = 50
	cloudAgentArrangeMaxGroups = 12
	cloudAgentArrangeMaxGap    = 400
	cloudAgentArrangeCoordCap  = 1e6
)

type cloudAgentArrangeGroup struct {
	Label   string   `json:"label,omitempty"`
	NodeIDs []string `json:"nodeIds"`
	Mode    string   `json:"mode,omitempty"`
}

type cloudAgentArrangeArgs struct {
	SnapshotHash string                   `json:"snapshotHash"`
	NodeIDs      []string                 `json:"nodeIds,omitempty"`
	Mode         string                   `json:"mode,omitempty"`
	Groups       []cloudAgentArrangeGroup `json:"groups,omitempty"`
	Align        string                   `json:"align,omitempty"`
	Gap          float64                  `json:"gap,omitempty"`
	DryRun       bool                     `json:"dryRun,omitempty"`
}

type cloudAgentArrangeMove struct {
	ID    string
	Title string
	From  layout.Position
	To    layout.Position
}

type cloudAgentArrangePlan struct {
	Args       cloudAgentArrangeArgs
	Canvas     *model.CanvasProject
	Document   map[string]any
	Positions  map[string]layout.Position
	Moves      []cloudAgentArrangeMove
	Skipped    []string
	BandLabels []string
	Preview    cloudAgentApprovalPreview
	BeforeHash string
	Mode       layout.Mode
}

// cloudAgentLayoutLane 把节点类型映射到整理泳道（与前端 canvasLayoutLane 的语义一致：
// 视频 / 音频 / 图片 / 文本，其余类型归文本泳道）。第二个返回值表示该类型是否参与整理。
func cloudAgentLayoutLane(nodeType string) (string, bool) {
	switch nodeType {
	case "video":
		return "video", true
	case "audio":
		return "audio", true
	case "image":
		return "image", true
	case "text", "markdown", "script", "batch-table":
		return "text", true
	default:
		// 背板 / 文件夹是容器，插件节点也不参与几何整理。
		return "", false
	}
}

// cloudAgentLayoutNodes 把画布文档投影成排布输入。parentID 用于判断顶层节点。
func cloudAgentLayoutNodes(doc map[string]any) []layout.Node {
	raw := creationMaps(doc["nodes"])
	nodes := make([]layout.Node, 0, len(raw))
	for _, node := range raw {
		id := stringValue(node["id"])
		if id == "" {
			continue
		}
		lane, supported := cloudAgentLayoutLane(stringValue(node["type"]))
		item := layout.Node{ID: id, Type: stringValue(node["type"]), Lane: lane, NoMove: !supported}
		if position, ok := node["position"].(map[string]any); ok {
			if value, ok := cloudAgentSafeNumber(position["x"]); ok {
				item.X, _ = value.(float64)
			}
			if value, ok := cloudAgentSafeNumber(position["y"]); ok {
				item.Y, _ = value.(float64)
			}
		}
		if value, ok := cloudAgentSafeNumber(node["width"]); ok {
			item.Width, _ = value.(float64)
		}
		if value, ok := cloudAgentSafeNumber(node["height"]); ok {
			item.Height, _ = value.(float64)
		}
		if meta, ok := node["metadata"].(map[string]any); ok {
			item.Locked = meta["locked"] == true
		}
		nodes = append(nodes, item)
	}
	return nodes
}

// cloudAgentLayoutEdges 只取两端都在画布上的引用连线，用于依赖方向分层。
func cloudAgentLayoutEdges(doc map[string]any) []layout.Edge {
	edges := make([]layout.Edge, 0)
	for _, edge := range creationMaps(doc["connections"]) {
		from, to := stringValue(edge["fromNodeId"]), stringValue(edge["toNodeId"])
		if from == "" || to == "" {
			continue
		}
		edges = append(edges, layout.Edge{From: from, To: to})
	}
	return edges
}

// cloudAgentLayoutMovable 判断节点能否被 Agent 移动：锁定、容器节点、隐藏批次子节点、
// 以及已经归属某个背板的子节点都不动——用户手工摆过的位置和容器层级不是 Agent 的编排对象。
func cloudAgentLayoutMovable(node map[string]any) bool {
	meta, _ := node["metadata"].(map[string]any)
	if meta["locked"] == true {
		return false
	}
	if _, supported := cloudAgentLayoutLane(stringValue(node["type"])); !supported {
		return false
	}
	if strings.TrimSpace(stringValue(node["parentId"])) != "" {
		return false
	}
	if rootID := strings.TrimSpace(stringValue(meta["batchRootId"])); rootID != "" {
		return false
	}
	return true
}

func cloudAgentLayoutNodesByID(doc map[string]any) map[string]map[string]any {
	index := map[string]map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		if id := stringValue(node["id"]); id != "" {
			index[id] = node
		}
	}
	return index
}

func cloudAgentArrangeModeLabel(mode layout.Mode) string {
	switch mode {
	case layout.ModeFlow:
		return "layered by dependency"
	case layout.ModeByLane:
		return "grouped by media type"
	case layout.ModeRow:
		return "in a row"
	case layout.ModeColumn:
		return "in a column"
	case layout.ModeGrid:
		return "in a grid"
	default:
		return "automatic"
	}
}

func cloudAgentArrangeAlignLabel(align layout.AlignMode) string {
	switch align {
	case layout.AlignLeft:
		return "align left"
	case layout.AlignCenterX:
		return "center horizontally"
	case layout.AlignRight:
		return "align right"
	case layout.AlignTop:
		return "align top"
	case layout.AlignCenterY:
		return "center vertically"
	case layout.AlignBottom:
		return "align bottom"
	case layout.AlignDistributeX:
		return "distribute horizontally"
	case layout.AlignDistributeY:
		return "distribute vertically"
	default:
		return ""
	}
}

func cloudAgentArrangeMode(value string) (layout.Mode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto":
		return layout.ModeAuto, nil
	case "flow":
		return layout.ModeFlow, nil
	case "bytype", "by_type", "lane", "lanes":
		return layout.ModeByLane, nil
	case "row":
		return layout.ModeRow, nil
	case "column":
		return layout.ModeColumn, nil
	case "grid":
		return layout.ModeGrid, nil
	default:
		return "", cloudAgentFieldError("mode", "invalid_value", "Invalid arrange mode: must be auto, flow, byType, row, column or grid")
	}
}

func cloudAgentArrangeAlign(value string) (layout.AlignMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return "", nil
	case "left", "centerx", "right", "top", "centery", "bottom", "distributex", "distributey":
		return layout.AlignMode(strings.ToLower(strings.TrimSpace(value))), nil
	default:
		return "", cloudAgentFieldError("align", "invalid_value", "Invalid align mode: must be left, centerX, right, top, centerY, bottom, distributeX or distributeY")
	}
}

// cloudAgentArrangeNodes 按 args 选出的节点集合。显式 nodeIds 会逐个校验：
// 不存在、被锁定或属于容器/隐藏批次的节点会被跳过并在回执里说明，而不是让整轮失败。
func cloudAgentArrangeScope(doc map[string]any, args cloudAgentArrangeArgs) ([]layout.Node, []string, error) {
	index := cloudAgentLayoutNodesByID(doc)
	all := cloudAgentLayoutNodes(doc)
	byID := map[string]layout.Node{}
	for _, node := range all {
		byID[node.ID] = node
	}

	requested := args.NodeIDs
	if len(args.Groups) > 0 {
		requested = nil
		seen := map[string]bool{}
		for _, group := range args.Groups {
			for _, id := range group.NodeIDs {
				id = strings.TrimSpace(id)
				if id == "" || seen[id] {
					continue
				}
				seen[id] = true
				requested = append(requested, id)
			}
		}
	}

	selected := make([]layout.Node, 0, len(requested))
	skipped := make([]string, 0)
	if len(requested) == 0 {
		for _, node := range all {
			if node.NoMove {
				continue
			}
			if !cloudAgentLayoutMovable(index[node.ID]) {
				continue
			}
			selected = append(selected, node)
		}
		return selected, skipped, nil
	}
	for _, id := range requested {
		node, ok := byID[id]
		if !ok {
			return nil, nil, cloudAgentFieldError("nodeIds", "invalid_value", fmt.Sprintf("Node %s to arrange is not on this canvas; read the canvas again", id))
		}
		if node.NoMove || !cloudAgentLayoutMovable(index[id]) {
			skipped = append(skipped, id)
			continue
		}
		selected = append(selected, node)
	}
	return selected, skipped, nil
}

func cloudAgentArrangePositions(doc map[string]any, args cloudAgentArrangeArgs, selected []layout.Node) (map[string]layout.Position, []string, layout.Mode, error) {
	index := map[string]layout.Node{}
	for _, node := range selected {
		index[node.ID] = node
	}
	mode, err := cloudAgentArrangeMode(args.Mode)
	if err != nil {
		return nil, nil, "", err
	}
	align, err := cloudAgentArrangeAlign(args.Align)
	if err != nil {
		return nil, nil, "", err
	}
	edges := cloudAgentLayoutEdges(doc)

	positions := map[string]layout.Position{}
	labels := make([]string, 0, len(args.Groups))
	if len(args.Groups) > 0 {
		bands := make([]layout.Band, 0, len(args.Groups))
		for _, group := range args.Groups {
			members := make([]layout.Node, 0, len(group.NodeIDs))
			for _, id := range group.NodeIDs {
				if node, ok := index[strings.TrimSpace(id)]; ok {
					members = append(members, node)
				}
			}
			if len(members) == 0 {
				continue
			}
			groupMode, err := cloudAgentArrangeMode(group.Mode)
			if err != nil {
				return nil, nil, "", err
			}
			if groupMode == layout.ModeAuto {
				groupMode = layout.ModeByLane
			}
			label := strings.TrimSpace(group.Label)
			if label == "" {
				label = fmt.Sprintf("Group %d", len(bands)+1)
			}
			labels = append(labels, label)
			if align != "" {
				// 分组 + 对齐：先在带内对齐，再把整带交给 Bands 排位置。
				members = applyLayout(members, layout.Align(members, align))
			}
			bands = append(bands, layout.Band{Label: label, Nodes: members, Mode: groupMode})
		}
		if len(bands) == 0 {
			return nil, nil, "", cloudAgentFieldError("groups", "invalid_value", "The group has no nodes that can be arranged")
		}
		positions = layout.Bands(bands, args.Gap)
	} else {
		switch mode {
		case layout.ModeAuto:
			positions = layout.Auto(selected, edges)
		case layout.ModeFlow:
			positions = layout.Flow(selected, edges)
		case layout.ModeByLane:
			positions = layout.ByLane(selected)
		default:
			positions = layout.Linear(selected, mode)
		}
		if align != "" {
			positions = mergeLayoutPositions(positions, layout.Align(applyLayout(selected, positions), align))
		}
	}
	// 坐标收敛：四舍五入到两位小数并夹到安全范围，避免浮点噪声进入画布文档。
	for id, position := range positions {
		positions[id] = layout.Position{X: clampCoord(position.X), Y: clampCoord(position.Y)}
	}
	return positions, labels, mode, nil
}

func clampCoord(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	value = math.Round(value*100) / 100
	if value > cloudAgentArrangeCoordCap {
		return cloudAgentArrangeCoordCap
	}
	if value < -cloudAgentArrangeCoordCap {
		return -cloudAgentArrangeCoordCap
	}
	return value
}

func applyLayout(nodes []layout.Node, positions map[string]layout.Position) []layout.Node {
	applied := make([]layout.Node, 0, len(nodes))
	for _, node := range nodes {
		if position, ok := positions[node.ID]; ok {
			node.X, node.Y = position.X, position.Y
		}
		applied = append(applied, node)
	}
	return applied
}

func mergeLayoutPositions(base, override map[string]layout.Position) map[string]layout.Position {
	merged := make(map[string]layout.Position, len(base))
	for id, position := range base {
		merged[id] = position
	}
	for id, position := range override {
		merged[id] = position
	}
	return merged
}

// prepareCloudAgentArrangeNodes 复刻 canvas_apply_ops 的准备流程：校验快照、算出新坐标、生成审批预览。
// 它不写库；真正落库在 applyCloudAgentArrangeNodes（或在审批通过后的同一条执行路径里）。
func prepareCloudAgentArrangeNodes(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentArrangePlan, error) {
	var args cloudAgentArrangeArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.SnapshotHash) == "" {
		return nil, cloudAgentFieldError("snapshotHash", "required", "Arranging nodes needs a canvas read first and its snapshotHash")
	}
	if len(args.Groups) > cloudAgentArrangeMaxGroups {
		return nil, cloudAgentFieldError("groups", "item_count", fmt.Sprintf("At most %d groups at once", cloudAgentArrangeMaxGroups))
	}
	if args.Gap < 0 || args.Gap > cloudAgentArrangeMaxGap {
		return nil, cloudAgentFieldError("gap", "invalid_value", fmt.Sprintf("Group spacing must be between 0 and %d", cloudAgentArrangeMaxGap))
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
	if beforeHash != strings.TrimSpace(args.SnapshotHash) {
		// 与 canvas_apply_ops 同一写法：过期快照是"可纠正的参数错误"，运行期把它当工具结果
		// 交回模型重新读取，而不是走准入失败分支终止整轮。
		return nil, &cloudAgentFieldArgumentError{
			error: &cloudAgentArgumentError{creationConflict("The canvas changed, so nothing was arranged; read it again and request approval again")},
			Field: "snapshotHash", Issue: "stale_snapshot",
		}
	}
	selected, skipped, err := cloudAgentArrangeScope(doc, args)
	if err != nil {
		return nil, err
	}
	if len(selected) < 2 {
		return nil, cloudAgentFieldError("nodeIds", "invalid_value", "Fewer than two nodes can be arranged; for a single node set its coordinates with update_node")
	}
	if len(selected) > cloudAgentArrangeMaxNodes {
		return nil, cloudAgentFieldError("nodeIds", "item_count", fmt.Sprintf("At most %d nodes can be arranged at once; work in batches or limit the scope with nodeIds", cloudAgentArrangeMaxNodes))
	}
	positions, labels, mode, err := cloudAgentArrangePositions(doc, args, selected)
	if err != nil {
		return nil, err
	}

	moves := make([]cloudAgentArrangeMove, 0, len(positions))
	for _, node := range selected {
		position, ok := positions[node.ID]
		if !ok {
			continue
		}
		if math.Abs(position.X-node.X) < 0.01 && math.Abs(position.Y-node.Y) < 0.01 {
			continue
		}
		moves = append(moves, cloudAgentArrangeMove{ID: node.ID, From: layout.Position{X: node.X, Y: node.Y}, To: position})
	}
	plan := &cloudAgentArrangePlan{
		Args: args, Canvas: canvas, Document: doc, Positions: positions,
		Skipped: skipped, BandLabels: labels, BeforeHash: beforeHash, Mode: mode,
	}
	if len(moves) == 0 {
		return plan, nil
	}
	titles := cloudAgentLayoutTitles(doc)
	for _, move := range moves {
		move.Title = titles[move.ID]
		plan.Moves = append(plan.Moves, move)
	}
	plan.Preview = cloudAgentArrangePreview(doc, plan)
	return plan, nil
}

func cloudAgentLayoutTitles(doc map[string]any) map[string]string {
	titles := map[string]string{}
	for _, node := range creationMaps(doc["nodes"]) {
		id := stringValue(node["id"])
		if id == "" {
			continue
		}
		title := strings.TrimSpace(stringValue(node["title"]))
		if title == "" {
			if capability, ok := cloudAgentNodeCapabilityForNode(node); ok {
				title = capability.Label
			}
		}
		titles[id] = truncateRunes(title, 60)
	}
	return titles
}

func cloudAgentArrangePreview(doc map[string]any, plan *cloudAgentArrangePlan) cloudAgentApprovalPreview {
	modeLabel := cloudAgentArrangeModeLabel(plan.Mode)
	headline := fmt.Sprintf("Arrange %d nodes (%s)", len(plan.Moves), modeLabel)
	if len(plan.BandLabels) > 0 {
		headline = fmt.Sprintf("Put %d nodes into %d groups and arrange them", len(plan.Moves), len(plan.BandLabels))
	}
	if alignLabel := cloudAgentArrangeAlignLabel(layout.AlignMode(strings.ToLower(strings.TrimSpace(plan.Args.Align)))); alignLabel != "" {
		headline += ", " + alignLabel
	}
	details := make([]string, 0, 6)
	if len(plan.BandLabels) > 0 {
		details = append(details, "Groups: "+strings.Join(plan.BandLabels, " / "))
	}
	details = append(details, fmt.Sprintf("Move %d nodes (limit %d)", len(plan.Moves), cloudAgentArrangeMaxNodes))
	for index, move := range plan.Moves {
		if index == 6 {
			details = append(details, fmt.Sprintf("… %d nodes in total", len(plan.Moves)))
			break
		}
		details = append(details, fmt.Sprintf("%s → (%g, %g)", move.Title, move.To.X, move.To.Y))
	}
	if len(plan.Skipped) > 0 {
		details = append(details, fmt.Sprintf("%d locked/container/hidden nodes stay in place", len(plan.Skipped)))
	}
	return cloudAgentApprovalPreview{
		Kind:        "arrange_nodes",
		Title:       "Arrange nodes",
		Description: headline + "; only coordinates change: no content, edges or layering are touched.",
		Items: []cloudAgentApprovalPreviewItem{{
			Operation: "arrange_nodes",
			Summary:   headline,
			Details:   details,
		}},
	}
}

// applyCloudAgentArrangeNodes 落库并记录一次可撤销的 mutation。
func applyCloudAgentArrangeNodes(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentArrangeNodes(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if len(plan.Moves) == 0 {
		return map[string]any{
			"canvasId": canvasID, "snapshotHash": plan.BeforeHash, "moved": 0,
			"summary": "The nodes are already arranged; nothing changed",
		}, nil
	}
	if plan.Args.DryRun {
		ids := make([]string, 0, len(plan.Moves))
		for _, move := range plan.Moves {
			ids = append(ids, move.ID)
		}
		return map[string]any{
			"canvasId": canvasID, "snapshotHash": plan.BeforeHash, "moved": 0, "wouldMove": len(ids),
			"nodeIds": ids, "summary": fmt.Sprintf("Dry run: %d nodes would move; nothing was written to the canvas", len(ids)),
		}, nil
	}
	before := plan.Canvas.PayloadJSON
	if err := cloudAgentApplyArrangePositions(plan); err != nil {
		return nil, err
	}
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{
			UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: "canvas_arrange_nodes",
			BeforeSnapshotHash: plan.BeforeHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document),
			BeforeJSON: before, Preview: &plan.Preview,
		}); err != nil {
			return nil, err
		}
	}
	ids := make([]string, 0, len(plan.Moves))
	for _, move := range plan.Moves {
		ids = append(ids, move.ID)
	}
	return map[string]any{
		"canvasId": canvasID, "snapshotHash": cloudAgentCanvasHash(plan.Document),
		"beforeSnapshotHash": plan.BeforeHash, "moved": len(plan.Moves), "nodeIds": ids,
		"groups": plan.BandLabels, "skipped": plan.Skipped,
		"summary": fmt.Sprintf("Arranged %d nodes (%s)", len(plan.Moves), cloudAgentArrangeModeLabel(plan.Mode)),
	}, nil
}

func cloudAgentApplyArrangePositions(plan *cloudAgentArrangePlan) error {
	nodes := creationMaps(plan.Document["nodes"])
	for index, node := range nodes {
		position, ok := plan.Positions[stringValue(node["id"])]
		if !ok {
			continue
		}
		current, _ := node["position"].(map[string]any)
		if current == nil {
			current = map[string]any{}
		}
		current["x"] = position.X
		current["y"] = position.Y
		node["position"] = current
		nodes[index] = node
	}
	plan.Document["nodes"] = nodes
	return nil
}

// cloudAgentArrangeAddNodePosition 给"没给坐标"的新节点找一个有序的落位：
// 优先贴着本批建立连线的对端（生成输入在左、输出在右），否则按泳道追加到同类节点之后。
func cloudAgentArrangeAddNodePosition(doc map[string]any, pending []layout.Node, op agentCanvasOp, ops []agentCanvasOp, hint *layout.Position) (layout.Position, bool) {
	lane, supported := cloudAgentLayoutLane(op.NodeType)
	if !supported {
		return layout.Position{}, false
	}
	width, height := cloudAgentAddedNodeSize(op.NodeType)
	occupied := append([]layout.Node{}, cloudAgentLayoutNodes(doc)...)
	occupied = append(occupied, pending...)

	preferred := hint
	for _, candidate := range ops {
		if candidate.Type != "connect_nodes" {
			continue
		}
		if preferred != nil {
			break
		}
		switch {
		case candidate.ToNodeID == op.ID:
			if source, ok := findLayoutNode(occupied, candidate.FromNodeID); ok {
				preferred = &layout.Position{X: source.X + source.Width + layout.PlacementGap, Y: source.Y}
			}
		case candidate.FromNodeID == op.ID:
			if target, ok := findLayoutNode(occupied, candidate.ToNodeID); ok {
				preferred = &layout.Position{X: target.X - width - layout.PlacementGap, Y: target.Y}
			}
		}
	}
	return layout.FreeSlot(width, height, lane, occupied, preferred, layout.PlacementGap), true
}

func findLayoutNode(nodes []layout.Node, id string) (layout.Node, bool) {
	for _, node := range nodes {
		if node.ID == id {
			return node, true
		}
	}
	return layout.Node{}, false
}

func cloudAgentAddedNodeSize(nodeType string) (float64, float64) {
	if capability, ok := cloudAgentNodeCapabilityForType(nodeType); ok {
		return capability.DefaultWidth, capability.DefaultHeight
	}
	return 340, 240
}
