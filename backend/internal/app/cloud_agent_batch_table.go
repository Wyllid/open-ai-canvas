package app

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	maxCloudAgentBatchRows        = 500
	maxCloudAgentBatchReferences  = 10
	maxCloudAgentBatchPromptRunes = 20000
)

const (
	cloudAgentTryOnBatchPrompt    = "Reference image 1 is the original photo of the person and reference image 2 is the target garment. Keep the person's identity, facial features, pose and background unchanged, and replace their clothing with the garment in reference image 2. Reproduce the garment's cut, color, material, texture and decorative details accurately, make it fit naturally, and match the lighting of the original photo."
	cloudAgentCreativeBatchPrompt = "Create a new commercial image based on the reference images, keeping the subject's identity and key product details, with a complete composition and natural lighting."
)

type cloudAgentBatchTableEditArgs struct {
	SnapshotHash string         `json:"snapshotHash"`
	NodeID       string         `json:"nodeId"`
	Action       string         `json:"action"`
	RowID        string         `json:"rowId"`
	Patch        map[string]any `json:"patch"`
	Operation    string         `json:"operation"`
	Concurrency  int            `json:"concurrency"`
	GlobalPrompt string         `json:"globalPrompt"`
}

type cloudAgentBatchTableMutationPlan struct {
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	Preview            cloudAgentApprovalPreview
}

func defaultCloudAgentBatchReferenceColumns() []any {
	return []any{
		map[string]any{"id": "reference-1", "label": "Reference 1"},
		map[string]any{"id": "reference-2", "label": "Reference 2"},
		map[string]any{"id": "reference-3", "label": "Reference 3"},
	}
}

func cloudAgentBatchTablePatchSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enabled":      map[string]any{"type": "boolean"},
			"inputNodeIds": map[string]any{"type": "array", "maxItems": maxCloudAgentBatchReferences, "items": map[string]any{"type": "string"}},
			"prompt":       map[string]any{"type": "string", "maxLength": maxCloudAgentBatchPromptRunes},
		},
		"additionalProperties": false,
	}
}

func batchTableArgumentError() error {
	return &cloudAgentArgumentError{BadAuthRequest("Invalid batch table tool arguments: only fields declared in the tool schema are allowed; read the node again and retry with structured arguments")}
}

func batchTableNodeFromDocument(doc map[string]any, nodeID string) (map[string]any, map[string]any, []map[string]any, []map[string]any, error) {
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != nodeID {
			continue
		}
		if stringValue(node["type"]) != "batch-table" {
			return nil, nil, nil, nil, BadAuthRequest("The target node is not a batch table node")
		}
		metadata, ok := node["metadata"].(map[string]any)
		if !ok {
			return nil, nil, nil, nil, BadAuthRequest("The batch table node data format is invalid")
		}
		table, ok := metadata["batchTable"].(map[string]any)
		if !ok {
			return nil, nil, nil, nil, BadAuthRequest("The batch table node has no structured data")
		}
		operation := stringValue(table["operation"])
		if operation != "try_on" && operation != "creative" {
			return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid task type")
		}
		concurrency, ok := cloudAgentInteger(table["concurrency"])
		if !ok || !cloudAgentBatchConcurrencyAllowed(concurrency) {
			return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid concurrency")
		}
		if rawPrompt, exists := table["globalPrompt"]; exists {
			globalPrompt, ok := rawPrompt.(string)
			if !ok || utf8.RuneCountInString(globalPrompt) > maxCloudAgentBatchPromptRunes {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid or too long global prompt")
			}
		}
		columns := creationMaps(table["referenceColumns"])
		if len(columns) < 1 || len(columns) > maxCloudAgentBatchReferences {
			return nil, nil, nil, nil, BadAuthRequest("The batch table must have 1 to 10 reference columns")
		}
		columnIDs := map[string]bool{}
		for _, column := range columns {
			id, label := stringValue(column["id"]), stringValue(column["label"])
			if validateCloudAgentID(id, "Reference column ID", 120) != nil || strings.TrimSpace(label) == "" || utf8.RuneCountInString(label) > 120 || columnIDs[id] {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has invalid or duplicate reference columns")
			}
			columnIDs[id] = true
		}
		rows := creationMaps(table["rows"])
		if len(rows) > maxCloudAgentBatchRows {
			return nil, nil, nil, nil, BadAuthRequest("A batch table can have at most 500 rows")
		}
		rowIDs := map[string]bool{}
		for _, row := range rows {
			rowID := stringValue(row["id"])
			if validateCloudAgentID(rowID, "Batch row ID", 120) != nil || rowIDs[rowID] {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has invalid or duplicate row IDs")
			}
			rowIDs[rowID] = true
			if _, ok := row["enabled"].(bool); !ok {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid enabled state")
			}
			prompt, ok := row["prompt"].(string)
			if !ok || utf8.RuneCountInString(prompt) > maxCloudAgentBatchPromptRunes {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid or too long prompt")
			}
			if _, err := cloudAgentBatchInputNodeIDs(row["inputNodeIds"], len(columns)); err != nil {
				return nil, nil, nil, nil, err
			}
			if outputNodeID := stringValue(row["outputNodeId"]); outputNodeID != "" && validateCloudAgentID(outputNodeID, "Output node ID", 120) != nil {
				return nil, nil, nil, nil, BadAuthRequest("The batch table has an invalid output node ID")
			}
		}
		return node, table, rows, columns, nil
	}
	return nil, nil, nil, nil, BadAuthRequest("Batch table node not found on this canvas")
}

func cloudAgentBatchInputNodeIDs(value any, maxItems int) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]string); typedOK {
			items = make([]any, len(typed))
			for index, item := range typed {
				items[index] = item
			}
		} else {
			return nil, BadAuthRequest("A batch row's inputNodeIds must be an array of image node IDs")
		}
	}
	if len(items) > maxItems || len(items) > maxCloudAgentBatchReferences {
		return nil, BadAuthRequest("Each row's reference count cannot exceed the current number of reference columns")
	}
	result := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		id, ok := item.(string)
		if !ok || validateCloudAgentID(id, "Reference image node ID", 80) != nil || seen[id] {
			return nil, BadAuthRequest("The batch row has invalid or duplicate image node IDs")
		}
		seen[id] = true
		result = append(result, id)
	}
	return result, nil
}

func validateCloudAgentBatchInputNodes(doc map[string]any, inputNodeIDs []string) error {
	nodes := map[string]map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		nodes[stringValue(node["id"])] = node
	}
	for _, id := range inputNodeIDs {
		node := nodes[id]
		if node == nil || stringValue(node["type"]) != "image" {
			return BadAuthRequest("A batch table can only reference image nodes that exist on this canvas")
		}
	}
	return nil
}

func prepareCloudAgentBatchTableEdit(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentBatchTableMutationPlan, error) {
	var args cloudAgentBatchTableEditArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, batchTableArgumentError()
	}
	if args.SnapshotHash == "" || args.NodeID == "" {
		return nil, BadAuthRequest("Editing a batch table needs the latest snapshot and the node ID")
	}
	if err := validateCloudAgentID(args.NodeID, "Batch table node ID", 80); err != nil {
		return nil, err
	}
	allowedActions := map[string]bool{"append": true, "update": true, "remove": true, "set_operation": true, "set_concurrency": true, "add_reference_column": true, "remove_reference_column": true, "set_global_prompt": true}
	if !allowedActions[args.Action] {
		return nil, BadAuthRequest("Invalid batch table action")
	}
	if args.Action == "append" && args.RowID != "" {
		return nil, BadAuthRequest("Appending a batch row cannot specify an existing rowId")
	}
	if (args.Action == "update" || args.Action == "remove") && validateCloudAgentID(args.RowID, "Batch row ID", 120) != nil {
		return nil, BadAuthRequest("Update or delete must use a real rowId from the latest read")
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
	if !cloudAgentNodeSnapshotMatches(doc, args.NodeID, args.SnapshotHash) {
		return nil, cloudAgentFieldError("snapshotHash", "stale_snapshot", "This batch table changed after you read it, so nothing was written; read it again before editing")
	}
	node, table, rows, columns, err := batchTableNodeFromDocument(doc, args.NodeID)
	if err != nil {
		return nil, err
	}
	metadata := node["metadata"].(map[string]any)
	if metadata["locked"] == true {
		return nil, BadAuthRequest("A locked batch table cannot be changed")
	}
	index := -1
	for i, row := range rows {
		if stringValue(row["id"]) == args.RowID {
			index = i
			break
		}
	}
	if (args.Action == "update" || args.Action == "remove") && index < 0 {
		return nil, BadAuthRequest("Batch row not found; read the real rowId first")
	}

	fields := []string{}
	summaryVerb := "Update"
	switch args.Action {
	case "append", "update":
		if args.Action == "update" && len(args.Patch) == 0 {
			return nil, BadAuthRequest("Updating a batch row needs a patch")
		}
		patch, labels, err := validateCloudAgentBatchRowPatch(doc, args.Patch, len(columns))
		if err != nil {
			return nil, err
		}
		fields = labels
		if args.Action == "append" {
			if len(rows) >= maxCloudAgentBatchRows {
				return nil, BadAuthRequest("A batch table can have at most 500 rows")
			}
			operation := stringValue(table["operation"])
			prompt := cloudAgentTryOnBatchPrompt
			if operation == "creative" {
				prompt = cloudAgentCreativeBatchPrompt
			}
			inheritedInputNodeIDs := []any{}
			if len(rows) > 0 {
				inheritedInputNodeIDs = append(inheritedInputNodeIDs, cloudAgentBatchInputIDs(rows[len(rows)-1]["inputNodeIds"], len(columns))...)
			}
			row := map[string]any{"id": cloudAgentID(userID, fmt.Sprintf("batch-table:%s:%s:%d", args.NodeID, call.ID, len(rows)+1)), "enabled": true, "inputNodeIds": inheritedInputNodeIDs, "prompt": prompt}
			for key, value := range patch {
				row[key] = value
			}
			rows = append(rows, row)
			summaryVerb = "Append a row to"
			if len(fields) == 0 {
				fields = []string{"Task row"}
			}
		} else {
			for key, value := range patch {
				rows[index][key] = value
			}
			summaryVerb = "Update"
		}
		table["rows"] = mapsAsAny(rows)
	case "remove":
		if len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("Removing a batch row accepts no other change arguments")
		}
		rows = append(rows[:index], rows[index+1:]...)
		table["rows"] = mapsAsAny(rows)
		fields, summaryVerb = []string{"Task row"}, "Remove a row from"
	case "set_operation":
		if args.Operation != "try_on" && args.Operation != "creative" {
			return nil, BadAuthRequest("Batch task type must be try_on or creative")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Concurrency != 0 {
			return nil, BadAuthRequest("Setting the batch task type accepts no row-level arguments")
		}
		table["operation"] = args.Operation
		fields = []string{"Task type"}
	case "set_concurrency":
		if !cloudAgentBatchConcurrencyAllowed(args.Concurrency) {
			return nil, BadAuthRequest("Concurrency must be 1, 5 or 10")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" {
			return nil, BadAuthRequest("Setting concurrency accepts no row-level arguments")
		}
		table["concurrency"] = float64(args.Concurrency)
		fields = []string{"Concurrency"}
	case "add_reference_column":
		if len(columns) >= maxCloudAgentBatchReferences {
			return nil, BadAuthRequest("A batch table supports at most 10 reference sets")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("Adding a reference column accepts no other change arguments")
		}
		next := len(columns) + 1
		columns = append(columns, map[string]any{"id": cloudAgentID(userID, fmt.Sprintf("batch-column:%s:%s:%d", args.NodeID, call.ID, next)), "label": fmt.Sprintf("Reference %d", next)})
		table["referenceColumns"] = mapsAsAny(columns)
		fields = []string{"Reference column"}
		summaryVerb = "Add a reference column to"
	case "remove_reference_column":
		if len(columns) <= 1 {
			return nil, BadAuthRequest("A batch table must keep at least 1 reference set")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("Removing a reference column accepts no other change arguments")
		}
		columns = columns[:len(columns)-1]
		for index, column := range columns {
			column["label"] = fmt.Sprintf("Reference %d", index+1)
		}
		table["referenceColumns"] = mapsAsAny(columns)
		for _, row := range rows {
			row["inputNodeIds"] = cloudAgentBatchInputIDs(row["inputNodeIds"], len(columns))
		}
		table["rows"] = mapsAsAny(rows)
		fields = []string{"Reference column"}
		summaryVerb = "Remove a reference column from"
	case "set_global_prompt":
		if utf8.RuneCountInString(args.GlobalPrompt) > maxCloudAgentBatchPromptRunes {
			return nil, BadAuthRequest("The global prompt must be text of at most 20000 characters")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("Setting the global prompt accepts no other change arguments")
		}
		if strings.TrimSpace(args.GlobalPrompt) == "" {
			delete(table, "globalPrompt")
		} else {
			table["globalPrompt"] = args.GlobalPrompt
		}
		fields = []string{"Global prompt"}
		summaryVerb = "Set the global prompt on"
	}
	metadata["batchTable"] = table
	title := cloudAgentApprovalNodeTitle(node, "Batch table")
	preview := cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "Confirm batch table changes", Description: "The Agent is about to change the batch table's structured task data. Nothing is written to the canvas until you approve; this does not submit generation tasks.",
		Items: []cloudAgentApprovalPreviewItem{{Operation: "edit_batch_table", NodeID: args.NodeID, NodeTitle: title, NodeType: "batch-table", NodeTypeLabel: "Batch table", Fields: fields, Summary: fmt.Sprintf("%s batch table '%s'", summaryVerb, title)}},
	}
	return &cloudAgentBatchTableMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, Preview: preview}, nil
}

func validateCloudAgentBatchRowPatch(doc map[string]any, input map[string]any, maxInputs int) (map[string]any, []string, error) {
	patch := map[string]any{}
	labels := []string{}
	for key, value := range input {
		switch key {
		case "enabled":
			if _, ok := value.(bool); !ok {
				return nil, nil, BadAuthRequest("enabled must be a boolean")
			}
			patch[key], labels = value, append(labels, "Enabled")
		case "prompt":
			text, ok := value.(string)
			if !ok || utf8.RuneCountInString(text) > maxCloudAgentBatchPromptRunes {
				return nil, nil, BadAuthRequest("The prompt must be text of at most 20000 characters")
			}
			patch[key], labels = text, append(labels, "Prompt")
		case "inputNodeIds":
			ids, err := cloudAgentBatchInputNodeIDs(value, maxInputs)
			if err != nil {
				return nil, nil, err
			}
			if err := validateCloudAgentBatchInputNodes(doc, ids); err != nil {
				return nil, nil, err
			}
			values := make([]any, len(ids))
			for index, id := range ids {
				values[index] = id
			}
			patch[key], labels = values, append(labels, "Reference images")
		default:
			return nil, nil, BadAuthRequest(fmt.Sprintf("Field %s cannot be changed with the batch table tool", key))
		}
	}
	sort.Strings(labels)
	return patch, labels, nil
}

func cloudAgentBatchConcurrencyAllowed(value int) bool {
	return value == 1 || value == 5 || value == 10
}

func applyCloudAgentBatchTableMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentBatchTableEdit(repo, userID, canvasID, call)
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
	return map[string]any{"canvasId": canvasID, "nodeId": appliedPreview.Items[0].NodeID, "snapshotHash": cloudAgentNodeHash(plan.Document, appliedPreview.Items[0].NodeID), "summary": appliedPreview.Description, "preview": appliedPreview}, nil
}

func cloudAgentBatchTableReadResult(view any, nodeID, nodeHash string) (map[string]any, error) {
	state, ok := view.(map[string]any)
	if !ok {
		return nil, BadAuthRequest("Invalid batch table read result")
	}
	nodes, _ := state["nodes"].([]any)
	if len(nodes) != 1 {
		return nil, BadAuthRequest("The batch table read result is missing the target node")
	}
	node, ok := nodes[0].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("The batch table read result format is invalid")
	}
	table, ok := node["batchTable"].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("The batch table read result is missing structured task rows")
	}
	rows, _ := table["rows"].([]any)
	for _, value := range rows {
		if row, ok := value.(map[string]any); ok {
			row["rowId"] = row["id"]
		}
	}
	return map[string]any{"nodeId": nodeID, "title": node["title"], "snapshotHash": nodeHash, "batchTable": table}, nil
}
