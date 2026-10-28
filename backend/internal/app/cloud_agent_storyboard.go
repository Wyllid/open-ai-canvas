package app

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const maxCloudAgentStoryboardRows = 100

var cloudAgentStoryboardTextFields = []string{
	"plotDescription", "dialogue", "videoMotionPrompt", "imageGenerationPrompt", "camera", "motion", "shotSize",
	"emotion", "lightingAndAtmosphere", "audioEffects", "narrativeIntent", "viewerPOV", "performanceBlocking",
	"timeBeats", "continuityOut", "negativePrompt",
}

type cloudAgentStoryboardCreateArgs struct {
	SnapshotHash string           `json:"snapshotHash"`
	NodeID       string           `json:"nodeId"`
	Title        string           `json:"title"`
	Rows         []map[string]any `json:"rows"`
	X            float64          `json:"x"`
	Y            float64          `json:"y"`
}

type cloudAgentStoryboardEditArgs struct {
	SnapshotHash string         `json:"snapshotHash"`
	NodeID       string         `json:"nodeId"`
	Action       string         `json:"action"`
	RowID        string         `json:"rowId"`
	Patch        map[string]any `json:"patch"`
}

type cloudAgentStoryboardMutationPlan struct {
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	Preview            cloudAgentApprovalPreview
}

func storyboardArgumentError(action string) error {
	return &cloudAgentArgumentError{BadAuthRequest(fmt.Sprintf("Invalid storyboard %s arguments: only fields declared in the tool schema are allowed; read the storyboard again and retry with structured arguments", action))}
}

func cloudAgentStoryboardRowSchema() map[string]any {
	properties := map[string]any{
		"durationSeconds":       map[string]any{"type": "number", "exclusiveMinimum": 0},
		"plotDescription":       map[string]any{"type": "string", "maxLength": 20000},
		"dialogue":              map[string]any{"type": "string", "maxLength": 20000},
		"videoMotionPrompt":     map[string]any{"type": "string", "maxLength": 20000},
		"imageGenerationPrompt": map[string]any{"type": "string", "maxLength": 20000},
		"camera":                map[string]any{"type": "string", "maxLength": 20000},
		"motion":                map[string]any{"type": "string", "maxLength": 20000},
		"shotSize":              map[string]any{"type": "string", "maxLength": 20000},
		"emotion":               map[string]any{"type": "string", "maxLength": 20000},
		"lightingAndAtmosphere": map[string]any{"type": "string", "maxLength": 20000},
		"audioEffects":          map[string]any{"type": "string", "maxLength": 20000},
		"narrativeIntent":       map[string]any{"type": "string", "maxLength": 20000},
		"viewerPOV":             map[string]any{"type": "string", "maxLength": 20000},
		"performanceBlocking":   map[string]any{"type": "string", "maxLength": 20000},
		"timeBeats":             map[string]any{"type": "string", "maxLength": 20000},
		"continuityOut":         map[string]any{"type": "string", "maxLength": 20000},
		"negativePrompt":        map[string]any{"type": "string", "maxLength": 20000},
	}
	return map[string]any{"type": "object", "properties": properties, "required": []string{"durationSeconds"}, "additionalProperties": false}
}

func cloudAgentStoryboardPatchSchema() map[string]any {
	schema := cloudAgentStoryboardRowSchema()
	delete(schema, "required")
	schema["minProperties"] = 1
	return schema
}

func validateCloudAgentStoryboardRow(row map[string]any, requireDescription bool, fieldPath string) error {
	if row == nil {
		return BadAuthRequest("Storyboard rows must not be empty")
	}
	if duration, ok := row["durationSeconds"]; !ok {
		return BadAuthRequest("Every storyboard row needs durationSeconds")
	} else if value, ok := duration.(float64); !ok || value <= 0 {
		return BadAuthRequest("Storyboard duration must be a number greater than zero")
	}
	for key := range row {
		if key != "durationSeconds" && !cloudAgentStoryboardTextField(key) {
			return BadAuthRequest(fmt.Sprintf("Field %s cannot be written with the storyboard tool", key))
		}
	}
	for _, key := range cloudAgentStoryboardTextFields {
		if value, exists := row[key]; exists {
			text, ok := value.(string)
			if !ok || utf8.RuneCountInString(text) > 20000 {
				return BadAuthRequest(fmt.Sprintf("Storyboard field %s must be text of at most 20000 characters", key))
			}
		}
	}
	if requireDescription {
		plot := strings.TrimSpace(stringValue(row["plotDescription"]))
		motion := strings.TrimSpace(stringValue(row["videoMotionPrompt"]))
		imagePrompt := strings.TrimSpace(stringValue(row["imageGenerationPrompt"]))
		if plot == "" && motion == "" && imagePrompt == "" {
			return cloudAgentFieldError(fieldPath, "required", "A new shot needs a visual description, a first-frame prompt or a video prompt")
		}
	}
	return nil
}

func normalizeCloudAgentStoryboardRows(rows []map[string]any, userID, nodeID, seed string) ([]any, error) {
	if len(rows) < 1 || len(rows) > maxCloudAgentStoryboardRows {
		return nil, BadAuthRequest("A storyboard must have 1 to 100 shots")
	}
	out := make([]any, 0, len(rows))
	for index, input := range rows {
		if err := validateCloudAgentStoryboardRow(input, true, fmt.Sprintf("rows[%d]", index)); err != nil {
			return nil, err
		}
		row := cloudAgentStoryboardRowDefaults()
		for key, value := range input {
			row[key] = value
		}
		row["id"] = cloudAgentID(userID, fmt.Sprintf("storyboard:%s:%s:%d", nodeID, seed, index+1))
		row["shotNumber"] = float64(index + 1)
		out = append(out, row)
	}
	return out, nil
}

func storyboardNodeFromDocument(doc map[string]any, nodeID string) (map[string]any, map[string]any, []map[string]any, error) {
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != nodeID {
			continue
		}
		if stringValue(node["type"]) != "script" {
			return nil, nil, nil, BadAuthRequest("The target node is not a storyboard node")
		}
		metadata, ok := node["metadata"].(map[string]any)
		if !ok {
			return nil, nil, nil, BadAuthRequest("Invalid storyboard node data format")
		}
		storyboard, ok := metadata["storyboard"].(map[string]any)
		if !ok {
			return nil, nil, nil, BadAuthRequest("The storyboard node has no structured table")
		}
		rows := creationMaps(storyboard["rows"])
		if len(rows) > maxCloudAgentStoryboardRows {
			return nil, nil, nil, BadAuthRequest("The storyboard exceeds the 100 shot limit")
		}
		ids := map[string]bool{}
		for _, row := range rows {
			rowID := stringValue(row["id"])
			if err := validateCloudAgentID(rowID, "Storyboard row ID", 120); err != nil || ids[rowID] {
				return nil, nil, nil, BadAuthRequest("The storyboard node has invalid or duplicate shot row IDs")
			}
			ids[rowID] = true
		}
		return node, storyboard, rows, nil
	}
	return nil, nil, nil, BadAuthRequest("Storyboard node not found on this canvas")
}

func prepareCloudAgentStoryboardCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentStoryboardMutationPlan, error) {
	var args cloudAgentStoryboardCreateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, storyboardArgumentError("create")
	}
	if args.SnapshotHash == "" || args.NodeID == "" || strings.TrimSpace(args.Title) == "" {
		return nil, BadAuthRequest("Creating a storyboard needs a snapshot, a node ID and a title")
	}
	if err := validateCloudAgentID(args.NodeID, "Storyboard node ID", 80); err != nil {
		return nil, err
	}
	if utf8.RuneCountInString(args.Title) > 240 {
		return nil, BadAuthRequest("The storyboard title exceeds the limit")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	// 新建节点不依赖其它节点的内容：用户同时删改别的节点不影响这次创建，只要求 ID 未被占用。
	beforeHash := cloudAgentCanvasHash(doc)
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) == args.NodeID {
			return nil, BadAuthRequest("Storyboard node ID already exists")
		}
	}
	rows, err := normalizeCloudAgentStoryboardRows(args.Rows, userID, args.NodeID, call.ID)
	if err != nil {
		return nil, err
	}
	node := creationAddedNode(CreationCanvasOp{
		Type: "add_node", ID: args.NodeID, NodeType: "script", Title: args.Title, X: &args.X, Y: &args.Y,
		Metadata: map[string]any{"storyboard": map[string]any{
			"rows": rows, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{},
		}},
	})
	doc["nodes"] = append(creationMaps(doc["nodes"]), node)
	return &cloudAgentStoryboardMutationPlan{
		Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash,
		Preview: cloudAgentApprovalPreview{Kind: "canvas_mutation", Title: "Confirm storyboard creation", Description: fmt.Sprintf("The Agent is about to create storyboard '%s' with %d shots. Nothing is written to the canvas until you approve.", args.Title, len(rows)), Items: []cloudAgentApprovalPreviewItem{{Operation: "create_storyboard", NodeID: args.NodeID, NodeTitle: args.Title, NodeType: "script", NodeTypeLabel: "Storyboard", Summary: fmt.Sprintf("Create storyboard '%s' (%d shots)", args.Title, len(rows))}}},
	}, nil
}

func prepareCloudAgentStoryboardEdit(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentStoryboardMutationPlan, error) {
	var args cloudAgentStoryboardEditArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, storyboardArgumentError("edit")
	}
	if args.SnapshotHash == "" || args.NodeID == "" {
		return nil, BadAuthRequest("Editing a storyboard needs a snapshot and the node ID")
	}
	if args.Action != "append" && args.Action != "update" && args.Action != "remove" {
		return nil, BadAuthRequest("Storyboard action must be append, update or remove")
	}
	if err := validateCloudAgentID(args.NodeID, "Storyboard node ID", 80); err != nil {
		return nil, err
	}
	if args.Action == "append" && args.RowID != "" {
		return nil, BadAuthRequest("Appending a shot cannot specify an existing rowId")
	}
	if args.Action != "append" {
		if err := validateCloudAgentID(args.RowID, "Storyboard row ID", 120); err != nil {
			return nil, BadAuthRequest("Updating or removing a shot must use a real rowId from the latest read")
		}
	}
	if args.Action == "remove" && len(args.Patch) != 0 {
		return nil, BadAuthRequest("Removing a shot does not accept a patch")
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
	node, storyboard, rows, err := storyboardNodeFromDocument(doc, args.NodeID)
	if err != nil {
		return nil, err
	}
	if !cloudAgentNodeSnapshotMatches(doc, args.NodeID, args.SnapshotHash) {
		return nil, cloudAgentFieldError("snapshotHash", "stale_snapshot", "This storyboard changed after you read it, so nothing was written; read the storyboard again before editing")
	}
	index := -1
	for i, row := range rows {
		if stringValue(row["id"]) == args.RowID {
			index = i
			break
		}
	}
	if args.Action != "append" && index < 0 {
		return nil, BadAuthRequest("Storyboard row not found; read the real row ID first")
	}
	next := make([]map[string]any, len(rows))
	for i, row := range rows {
		next[i] = row
	}
	fields := []string{}
	switch args.Action {
	case "remove":
		next = append(next[:index], next[index+1:]...)
		fields = []string{"Shot row"}
	case "append", "update":
		if len(args.Patch) == 0 {
			return nil, BadAuthRequest("The storyboard action needs a patch")
		}
		patch := map[string]any{}
		for key, value := range args.Patch {
			if key == "durationSeconds" {
				if duration, ok := value.(float64); !ok || duration <= 0 {
					return nil, BadAuthRequest("Storyboard duration must be a number greater than zero")
				}
			} else if cloudAgentStoryboardTextField(key) {
				text, ok := value.(string)
				if !ok || utf8.RuneCountInString(text) > 20000 {
					return nil, BadAuthRequest(fmt.Sprintf("Storyboard field %s must be text of at most 20000 characters", key))
				}
			} else {
				return nil, BadAuthRequest(fmt.Sprintf("Field %s cannot be changed by a storyboard edit", key))
			}
			patch[key] = value
			fields = append(fields, key)
		}
		sort.Strings(fields)
		if args.Action == "append" {
			if len(rows) >= maxCloudAgentStoryboardRows {
				return nil, BadAuthRequest("A storyboard can have at most 100 shots")
			}
			if err := validateCloudAgentStoryboardRow(patch, true, "patch"); err != nil {
				return nil, err
			}
			row := cloudAgentStoryboardRowDefaults()
			for key, value := range patch {
				row[key] = value
			}
			row["id"] = cloudAgentID(userID, fmt.Sprintf("storyboard:%s:%s:%d", args.NodeID, call.ID, len(rows)+1))
			row["shotNumber"] = float64(len(rows) + 1)
			next = append(next, row)
		} else {
			for key, value := range patch {
				next[index][key] = value
			}
		}
	}
	for i, row := range next {
		row["shotNumber"] = float64(i + 1)
	}
	storyboard["rows"] = mapsAsAny(next)
	node["metadata"].(map[string]any)["storyboard"] = storyboard
	return &cloudAgentStoryboardMutationPlan{
		Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash,
		Preview: cloudAgentApprovalPreview{Kind: "canvas_mutation", Title: "Confirm storyboard changes", Description: "The Agent is about to change the storyboard. Nothing is written to the canvas until you approve.", Items: []cloudAgentApprovalPreviewItem{{Operation: "edit_storyboard", NodeID: args.NodeID, NodeTitle: stringValue(node["title"]), NodeType: "script", NodeTypeLabel: "Storyboard", Fields: fields, Summary: fmt.Sprintf("%s storyboard '%s'", map[string]string{"append": "Append shots to", "update": "Update", "remove": "Remove shots from"}[args.Action], stringValue(node["title"]))}}},
	}, nil
}

func applyCloudAgentStoryboardMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	var plan *cloudAgentStoryboardMutationPlan
	var err error
	if call.Function.Name == "canvas_create_storyboard" {
		plan, err = prepareCloudAgentStoryboardCreate(repo, userID, canvasID, call)
	} else {
		plan, err = prepareCloudAgentStoryboardEdit(repo, userID, canvasID, call)
	}
	if err != nil {
		return nil, err
	}
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	appliedPreview := cloudAgentCanvasAppliedPreview(plan.Preview)
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: call.Function.Name, BeforeSnapshotHash: plan.BeforeSnapshotHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document), BeforeJSON: plan.BeforeJSON, Preview: &appliedPreview}); err != nil {
			return nil, err
		}
	}
	nodeID := ""
	if len(plan.Preview.Items) > 0 {
		nodeID = plan.Preview.Items[0].NodeID
	}
	return map[string]any{"canvasId": canvasID, "nodeId": nodeID, "snapshotHash": cloudAgentNodeHash(plan.Document, nodeID), "summary": appliedPreview.Description, "preview": appliedPreview}, nil
}

func mapsAsAny(values []map[string]any) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

func cloudAgentStoryboardReadResult(view any, nodeID, nodeHash string) (map[string]any, error) {
	state, ok := view.(map[string]any)
	if !ok {
		return nil, BadAuthRequest("Invalid storyboard read result")
	}
	nodes, _ := state["nodes"].([]any)
	if len(nodes) != 1 {
		return nil, BadAuthRequest("The storyboard read result is missing the target node")
	}
	node, ok := nodes[0].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("The storyboard read result format is invalid")
	}
	storyboard, ok := node["storyboard"].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("The storyboard read result is missing shot rows")
	}
	rows, _ := storyboard["rows"].([]any)
	for _, value := range rows {
		if row, ok := value.(map[string]any); ok {
			row["rowId"] = row["id"]
		}
	}
	return map[string]any{
		"nodeId":       nodeID,
		"title":        node["title"],
		"snapshotHash": nodeHash,
		"storyboard":   storyboard,
	}, nil
}

func cloudAgentStoryboardTextField(target string) bool {
	for _, field := range cloudAgentStoryboardTextFields {
		if field == target {
			return true
		}
	}
	return false
}

func cloudAgentStoryboardRowDefaults() map[string]any {
	row := map[string]any{
		"characters":      []any{},
		"mustHave":        []any{},
		"optionalDetails": []any{},
		"assetBindings":   []any{},
		"status":          "idle",
	}
	for _, field := range cloudAgentStoryboardTextFields {
		row[field] = ""
	}
	return row
}
