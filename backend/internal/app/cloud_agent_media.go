package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// The Agent uses the same public catalog as the composer, never a second routing policy.
func (s *Service) cloudAgentModelList(intent *ModelRequestIntent) (any, error) {
	catalog, err := s.ModelCatalog(intent)
	if err != nil {
		return nil, err
	}
	logicalModels, err := s.PublicLogicalModels(intent)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, m := range logicalModels {
		if m.Available && cloudAgentGenerationModeSupported(normalizeCapability(m.Capability)) {
			items = append(items, map[string]any{"name": m.Name, "capability": m.Capability, "selection": map[string]any{"logicalModelId": m.ID}, "specTiers": m.PriceTiers, "options": m.CapabilitySpec, "profiles": m.CapabilityProfiles, "defaults": m.DefaultOptions})
		}
	}
	for _, channel := range catalog.Channels {
		for _, m := range channel.Models {
			if m.Available && cloudAgentGenerationModeSupported(normalizeCapability(m.Capability)) {
				items = append(items, map[string]any{"name": m.DisplayName, "capability": m.Capability, "selection": map[string]any{"channelId": channel.ID, "channelModelKey": m.ModelKey}, "specTiers": m.PriceTiers, "options": m.CapabilityConfig, "defaults": m.DefaultOptions})
			}
		}
	}
	for _, item := range items {
		selection := item["selection"].(map[string]any)
		arguments := map[string]any{"mode": normalizeCapability(stringValue(item["capability"]))}
		for key, value := range selection {
			arguments[key] = value
		}
		item["generationArguments"] = arguments
	}
	return map[string]any{
		"source": catalog.Source, "models": items, "intent": intent,
		"generationGuidance": "Copy generationArguments and fill in prompt and referenceNodeIds; to reuse a draft pass nodeId, otherwise leave the new node ID/title/connections to the executor. Omit the specification by default; when the user asks for a change in this run, pass supported values with configurationChange and inherit the rest of the existing configuration. Do not pass parameters, binding, count or image_to_image.",
	}, nil
}

// Resolve actual canvas resources before filtering the shared catalog. Counts
// supplied by the model must not replace resource ownership/readiness checks.
func (s *Service) cloudAgentModelIntent(userID, canvasID, arguments string) (*ModelRequestIntent, error) {
	var a struct {
		Mode             string   `json:"mode"`
		ReferenceNodeIDs []string `json:"referenceNodeIds"`
	}
	if err := decodeCloudAgentJSONObject(arguments, &a); err != nil {
		return nil, BadAuthRequest("Invalid model query arguments")
	}
	if a.Mode == "" && len(a.ReferenceNodeIDs) == 0 {
		return nil, nil
	}
	if !cloudAgentGenerationModeSupported(a.Mode) || len(a.ReferenceNodeIDs) > 16 {
		return nil, BadAuthRequest("Specify a supported generation mode; at most 16 reference nodes")
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
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
	refs := map[string]any{}
	seen := map[string]bool{}
	for _, id := range a.ReferenceNodeIDs {
		if id == "" || seen[id] || nodes[id] == nil {
			return nil, BadAuthRequest("Reference nodes do not exist or are duplicated")
		}
		seen[id] = true
		ref, field, err := cloudAgentMediaReference(s.repo, userID, canvas.ProjectID, nodes[id])
		if err != nil {
			return nil, err
		}
		list, _ := refs[field].([]any)
		refs[field] = append(list, ref)
	}
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return nil, err
	}
	refs["mode"] = a.Mode
	intent := ModelRequestIntentFromTaskInput(refs, "canvas_"+a.Mode, cloudAgentMediaOperation(a.Mode, refs))
	return &intent, nil
}

type cloudAgentMediaArgs struct {
	ConfigurationChange        *cloudAgentMediaConfigurationChange `json:"configurationChange,omitempty"`
	Prepared                   *cloudAgentPreparedMedia            `json:"-"`
	DraftRunID                 string                              `json:"-"`
	CharacterVersions          map[string]string                   `json:"-"`
	CharacterLabels            []string                            `json:"-"`
	Mode                       string                              `json:"mode"`
	Prompt                     string                              `json:"prompt"`
	LogicalModelID             string                              `json:"logicalModelId"`
	ChannelID                  string                              `json:"channelId"`
	ChannelModelKey            string                              `json:"channelModelKey"`
	Duration                   int                                 `json:"durationSeconds"`
	Size                       string                              `json:"size"`
	ImageResolution            string                              `json:"imageResolution"`
	ImageParameters            string                              `json:"imageParameters,omitempty"`
	Quality                    string                              `json:"quality"`
	VideoGenerateAudio         *bool                               `json:"videoGenerateAudio"`
	VideoWatermark             *bool                               `json:"videoWatermark"`
	VideoArkPrivateAssetUpload *bool                               `json:"videoArkPrivateAssetUpload"`
	VideoStartFrameNodeID      string                              `json:"videoStartFrameNodeId"`
	VideoEndFrameNodeID        string                              `json:"videoEndFrameNodeId"`
	SnapshotHash               string                              `json:"snapshotHash"`
	NodeID                     string                              `json:"nodeId"`
	Title                      string                              `json:"title"`
	SourceNodeID               string                              `json:"sourceNodeId"`
	ReferenceNodeIDs           []string                            `json:"referenceNodeIds"`
	ReferenceTransientIDs      []string                            `json:"referenceTransientIds"`
}

type cloudAgentMediaPlan struct {
	Args                cloudAgentMediaArgs
	CallID              string
	TransientReferences map[string]cloudAgentTransientReference
	// Prepared is populated by the auto path after its dry admission. Approval
	// mode keeps the same admission in state.Approval.Prepared.
	Prepared *cloudAgentPreparedMedia `json:"-"`
}

// A resumed draft's incoming edges must describe the new approved inputs,
// rather than retaining references removed from the generation request.
func cloudAgentMediaConnections(edges []map[string]any, a cloudAgentMediaArgs) []map[string]any {
	incoming := map[string]map[string]any{}
	result := make([]map[string]any, 0, len(edges))
	for _, edge := range edges {
		if stringValue(edge["toNodeId"]) != a.NodeID {
			result = append(result, edge)
		} else {
			incoming[stringValue(edge["fromNodeId"])] = edge
		}
	}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if edge := incoming[id]; edge != nil {
			result = append(result, edge)
			delete(incoming, id)
		}
	}
	return result
}

type cloudAgentReferenceAdapter struct {
	PayloadField string
	MIMEMajor    string
}

// Provider payload fields are an adapter concern, not a canvas node-type
// allow-list. A new reference kind must register both a canvas capability and
// an upstream media adapter before it can cross this boundary.
var cloudAgentReferenceAdapters = map[string]cloudAgentReferenceAdapter{
	"image": {PayloadField: "referenceImages", MIMEMajor: "image"},
	"video": {PayloadField: "referenceVideos", MIMEMajor: "video"},
	"audio": {PayloadField: "referenceAudios", MIMEMajor: "audio"},
}

// This is the provider/task boundary, not a node allow-list. A canvas
// descriptor alone cannot activate a billing or provider operation: that
// operation must have an implemented adapter before it is exposed to Agent.
var cloudAgentGenerationAdapters = map[string]struct{}{
	"image": {}, "video": {}, "audio": {},
}

func (s *Service) cloudAgentMediaModelName(a cloudAgentMediaArgs) (string, error) {
	if !cloudAgentGenerationModeSupported(a.Mode) {
		return "", BadAuthRequest("This generation mode is not supported by the Agent yet")
	}
	catalog, err := s.ModelCatalog(nil)
	if err != nil {
		return "", err
	}
	logicalModels, err := s.PublicLogicalModels(nil)
	if err != nil {
		return "", err
	}
	for _, m := range logicalModels {
		if a.LogicalModelID != "" && m.ID == a.LogicalModelID && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
			return m.Name, nil
		}
	}
	for _, channel := range catalog.Channels {
		if channel.ID != a.ChannelID {
			continue
		}
		for _, m := range channel.Models {
			if m.ModelKey == a.ChannelModelKey && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
				return m.DisplayName, nil
			}
		}
	}
	return "", BadAuthRequest("The model catalog changed; read the catalog again and ask the user to choose a model")
}

func cloudAgentReferenceDescriptor(node map[string]any) (cloudAgentNodeCapability, cloudAgentReferenceAdapter, error) {
	descriptor, known := cloudAgentNodeCapabilityForNode(node)
	if !known || !descriptor.Connection.CanReference || descriptor.InputKind == "" {
		return cloudAgentNodeCapability{}, cloudAgentReferenceAdapter{}, BadAuthRequest("This node cannot be used as a media reference asset")
	}
	adapter, supported := cloudAgentReferenceAdapters[descriptor.InputKind]
	if !supported {
		return cloudAgentNodeCapability{}, cloudAgentReferenceAdapter{}, BadAuthRequest("This node's reference input type is not wired into media generation yet")
	}
	return descriptor, adapter, nil
}

func cloudAgentReference(repo *repository.Repository, userID string, node map[string]any) (map[string]any, string, error) {
	descriptor, adapter, err := cloudAgentReferenceDescriptor(node)
	if err != nil {
		return nil, "", err
	}
	meta, _ := node["metadata"].(map[string]any)
	key := stringValue(meta["storageKey"])
	if !strings.HasPrefix(key, "resource:") {
		return nil, "", BadAuthRequest("The reference asset is not saved in the account resource library yet; upload it first, an external URL cannot replace it")
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil {
		return nil, "", BadAuthRequest("The reference asset does not exist or does not belong to the current user")
	}
	if resource.Status != "ready" || !strings.HasPrefix(strings.ToLower(resource.MimeType), adapter.MIMEMajor+"/") {
		return nil, "", BadAuthRequest("The reference asset is not ready or its media type does not match")
	}
	return map[string]any{"id": node["id"], "name": node["title"], "storageKey": key, "type": resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs, "inputKind": descriptor.InputKind}, adapter.PayloadField, nil
}

// Shared by the read projection and generation admission. Ownership of an
// otherwise eligible draft remains a separate, transactional admission check.
func cloudAgentMediaTargetIssue(node map[string]any, nodeType string) (string, string) {
	meta, _ := node["metadata"].(map[string]any)
	switch {
	case meta["locked"] == true:
		return "target_locked", "The target node is locked; generation cannot be submitted"
	case stringValue(meta["taskId"]) != "" || stringValue(meta["generationTaskId"]) != "":
		return "task_bound", "The target node is already linked to a task and cannot be overwritten; read generation or use task_get to check the original task status and errors"
	case stringValue(node["type"]) != nodeType:
		return "target_type_mismatch", "The target node type does not match the generation mode"
	case stringValue(meta["storageKey"]) != "" || stringValue(meta["content"]) != "":
		return "output_exists", "The target node already has media output and cannot be overwritten as an unsubmitted draft"
	case stringValue(meta["status"]) != "idle":
		return "target_not_idle", "The target node is not an idle unsubmitted draft; read the node and task status"
	}
	return "", ""
}

func cloudAgentMediaAdmissionRetryable(err error) bool {
	if err == nil {
		return false
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr.Retryable {
		return true
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode >= 500 || httpErr.StatusCode == 429 || httpErr.StatusCode == 408
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var circuitErr providerCircuitOpenError
	return errors.As(err, &circuitErr)
}

type cloudAgentMediaAdmissionError struct {
	error
	Reason         string
	NodeID         string
	ErrorClass     string
	Retryable      bool
	RequiredAction string
}

func (e *cloudAgentMediaAdmissionError) Unwrap() error { return e.error }

// cloudAgentWrapMediaAdmissionError turns an untyped failure from the media
// admission boundary into an explicit failure classification. Only errors that
// are independently known to be transient may continue automatically; model,
// parameter, permission and budget errors remain terminal before submission.
func cloudAgentWrapMediaAdmissionError(err error) error {
	if err == nil {
		return nil
	}
	var argumentErr *cloudAgentArgumentError
	if errors.As(err, &argumentErr) {
		return err
	}
	var admissionErr *cloudAgentMediaAdmissionError
	if errors.As(err, &admissionErr) {
		return err
	}
	// 能力校验拒绝的参数可以由模型自己改正，见 cloud_agent_media_capability_error.go。
	if argument := cloudAgentMediaCapabilityArgumentError(err); argument != nil {
		return argument
	}
	retryable := cloudAgentMediaAdmissionRetryable(err)
	action := "report_to_user"
	if retryable {
		action = "retry"
	}
	return &cloudAgentMediaAdmissionError{
		error:          err,
		Reason:         "media_admission_failed",
		ErrorClass:     cloudAgentToolErrorAdmission,
		Retryable:      retryable,
		RequiredAction: action,
	}
}

func cloudAgentMediaDocument(repo *repository.Repository, userID, canvasID string, args cloudAgentMediaArgs, transient ...map[string]cloudAgentTransientReference) (*model.CanvasProject, map[string]any, map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, nil, err
	}
	unchanged := args.SnapshotHash != "" && (cloudAgentCanvasHash(doc) == args.SnapshotHash || cloudAgentMediaContentHash(doc) == args.SnapshotHash)
	if args.Prepared != nil {
		dependency, err := cloudAgentMediaDependencyHash(doc, args)
		if err != nil {
			return nil, nil, nil, err
		}
		unchanged = dependency == args.Prepared.DependencyHash
	}
	if !unchanged {
		return nil, nil, nil, &cloudAgentMediaAdmissionError{
			error:  creationConflict("The canvas changed; read the canvas again and request approval again. No generation task was submitted"),
			Reason: "snapshot_conflict",
			NodeID: args.NodeID,
		}
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, nil, err
	}
	existing := nodes[args.NodeID]
	existingMeta, _ := existing["metadata"].(map[string]any)
	targetDescriptor, supported := cloudAgentNodeCapabilityForGenerationMode(args.Mode)
	if !supported {
		return nil, nil, nil, cloudAgentFieldError("mode", "invalid_value", "This generation mode is not supported by the Agent yet; use a mode listed in the tool schema")
	}
	if err := validateCloudAgentID(args.NodeID, "Generation node ID", 80); err != nil {
		return nil, nil, nil, cloudAgentFieldError("nodeId", "invalid_value", cloudAgentSafeToolError(err))
	}
	if existing != nil {
		if reason, issue := cloudAgentMediaTargetIssue(existing, targetDescriptor.Type); reason != "" {
			return nil, nil, nil, &cloudAgentMediaAdmissionError{
				error:  BadAuthRequest(issue),
				Reason: reason,
				NodeID: args.NodeID,
			}
		}
		if args.DraftRunID == "" {
			return nil, nil, nil, BadAuthRequest("Reusing the draft needs the current run identity")
		}
		ownerID := stringValue(existingMeta["agentDraftRunId"])
		if ownerID != "" && ownerID != args.DraftRunID {
			owner, err := repo.CloudAgent(userID, ownerID)
			if err != nil {
				return nil, nil, nil, BadAuthRequest("Cannot determine which run owns the draft; stop retrying and check the original draft")
			}
			if owner.CanvasID != canvasID || !cloudAgentRunTerminal(owner.Status) || owner.CleanupPending {
				return nil, nil, nil, BadAuthRequest("The draft is still handled by another run; finish or cancel that run first, and do not create another node to bypass approval")
			}
		}
	}
	if args.SourceNodeID != "" && nodes[args.SourceNodeID] == nil {
		return nil, nil, nil, cloudAgentFieldError("sourceNodeId", "not_found", "The source node is not on this canvas; read the canvas again and use a real text node ID, or leave it empty")
	}
	if source := nodes[args.SourceNodeID]; source != nil {
		descriptor, known := cloudAgentNodeCapabilityForNode(source)
		// 角色卡作为文本来源时只取其角色设定（由 cloudAgentMediaCharacters 校验非空）。
		if !known || !descriptor.Connection.CanSource || (descriptor.InputKind != "text" && descriptor.InputKind != "character") {
			return nil, nil, nil, cloudAgentFieldError("sourceNodeId", "invalid_value", "sourceNodeId only accepts nodes usable as text input; put media assets in referenceNodeIds and leave sourceNodeId empty")
		}
	}
	// Keep the media entry point subject to the same graph admission policy as
	// canvas_apply_ops. The old implementation only checked that references
	// existed, which allowed invalid edges (for example frame -> image) to be
	// smuggled in through generate_media.
	prospectiveConnections := cloudAgentMediaConnections(creationMaps(doc["connections"]), args)
	target := existing
	if target == nil {
		target = map[string]any{"id": args.NodeID, "type": targetDescriptor.Type}
	}
	prospectiveNodes := make([]map[string]any, 0, len(nodes)+1)
	for _, node := range nodes {
		prospectiveNodes = append(prospectiveNodes, node)
	}
	if existing == nil {
		prospectiveNodes = append(prospectiveNodes, target)
	}
	type prospectiveSource struct {
		id    string
		field string
	}
	prospectiveSources := make([]prospectiveSource, 0, len(args.ReferenceNodeIDs)+1)
	for i, id := range args.ReferenceNodeIDs {
		prospectiveSources = append(prospectiveSources, prospectiveSource{id: id, field: fmt.Sprintf("referenceNodeIds[%d]", i)})
	}
	if args.SourceNodeID != "" {
		prospectiveSources = append(prospectiveSources, prospectiveSource{id: args.SourceNodeID, field: "sourceNodeId"})
	}
	prospectiveSeen := map[string]bool{}
	for _, source := range prospectiveSources {
		sourceID := source.id
		if sourceID == "" || prospectiveSeen[sourceID] {
			continue
		}
		prospectiveSeen[sourceID] = true
		alreadyConnected := false
		for _, edge := range prospectiveConnections {
			if stringValue(edge["fromNodeId"]) == sourceID && stringValue(edge["toNodeId"]) == args.NodeID {
				alreadyConnected = true
				break
			}
		}
		if alreadyConnected {
			continue
		}
		if err := validateCloudAgentConnection(prospectiveNodes, sourceID, args.NodeID, prospectiveConnections); err != nil {
			return nil, nil, nil, cloudAgentFieldError(source.field, "invalid_connection", cloudAgentSafeToolError(err))
		}
		prospectiveConnections = append(prospectiveConnections, map[string]any{"fromNodeId": sourceID, "toNodeId": args.NodeID})
	}
	if args.Prepared != nil {
		refs, err := cloudAgentPreparedReferences(repo, userID, args.Prepared)
		return canvas, doc, refs, err
	}
	refs := map[string]any{}
	seen := map[string]bool{}
	for i, id := range args.ReferenceNodeIDs {
		if id == "" || seen[id] || nodes[id] == nil {
			return nil, nil, nil, cloudAgentFieldError(fmt.Sprintf("referenceNodeIds[%d]", i), "invalid_value", "Reference nodes do not exist or are duplicated; read the canvas again and use only real, unique media node IDs")
		}
		seen[id] = true
		if !cloudAgentCharacterNode(nodes[id]) {
			if _, _, err := cloudAgentReferenceDescriptor(nodes[id]); err != nil {
				return nil, nil, nil, cloudAgentFieldError(fmt.Sprintf("referenceNodeIds[%d]", i), "invalid_value", "referenceNodeIds only accepts supported media reference nodes; use sourceNodeId for a text source")
			}
		}
		ref, payloadField, e := cloudAgentMediaReference(repo, userID, canvas.ProjectID, nodes[id])
		if e != nil {
			return nil, nil, nil, e
		}
		list, _ := refs[payloadField].([]any)
		refs[payloadField] = append(list, ref)
	}
	if len(args.ReferenceTransientIDs) > 0 && len(transient) > 0 {
		available := map[string]cloudAgentTransientReference{}
		if len(transient) > 0 && transient[0] != nil {
			available = transient[0]
		}
		for i, id := range args.ReferenceTransientIDs {
			ref, ok := available[id]
			if !ok {
				return nil, nil, nil, BadAuthRequest("The temporary reference image does not exist or is no longer available; render the annotation again")
			}
			if !strings.HasPrefix(ref.MIMEType, "image/") {
				return nil, nil, nil, cloudAgentFieldError(fmt.Sprintf("referenceTransientIDs[%d]", i), "invalid_value", "A temporary reference must be an image; use an image reference or remove that ID")
			}
			if ref.ResourceID == "" || time.Now().After(ref.ExpiresAt) {
				return nil, nil, nil, BadAuthRequest("The temporary reference image is not ready or has expired; render the annotation again")
			}
			resolved, _, err := cloudAgentReference(repo, userID, map[string]any{"id": ref.ID, "type": "image", "title": ref.Name, "metadata": map[string]any{"storageKey": "resource:" + ref.ResourceID}})
			if err != nil {
				return nil, nil, nil, err
			}
			list, _ := refs["referenceImages"].([]any)
			refs["referenceImages"] = append(list, resolved)
		}
	}
	return canvas, doc, refs, nil
}

func validateCloudAgentMediaArgs(a cloudAgentMediaArgs, state *cloudAgentRuntime) error {
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	if err := validateCloudAgentMediaShape(a, state); err != nil {
		return err
	}
	return validateCloudAgentMediaBudget(a, state)
}

func validateCloudAgentMediaShape(a cloudAgentMediaArgs, state *cloudAgentRuntime) error {
	mode := strings.ToLower(strings.TrimSpace(a.Mode))
	if !cloudAgentGenerationModeSupported(mode) {
		return cloudAgentFieldError("mode", "invalid_value", "This generation mode is not supported by the Agent yet; use a mode listed in the tool schema")
	}
	a.Mode = mode
	if a.SnapshotHash == "" {
		return cloudAgentFieldError("snapshotHash", "required", "Canvas snapshot missing; read the current canvas and retry")
	}
	if len(a.SnapshotHash) != 64 {
		return cloudAgentFieldError("snapshotHash", "invalid_value", "Invalid canvas snapshot; read the current canvas again")
	}
	for _, r := range a.SnapshotHash {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return cloudAgentFieldError("snapshotHash", "invalid_value", "Invalid canvas snapshot; read the current canvas again")
		}
	}
	if err := validateCloudAgentID(a.NodeID, "Generation node ID", 80); err != nil {
		return cloudAgentFieldError("nodeId", "invalid_value", cloudAgentSafeToolError(err))
	}
	if a.SourceNodeID != "" {
		if err := validateCloudAgentID(a.SourceNodeID, "Source node ID", 80); err != nil {
			return cloudAgentFieldError("sourceNodeId", "invalid_value", cloudAgentSafeToolError(err))
		}
	}
	for i, id := range a.ReferenceNodeIDs {
		if err := validateCloudAgentID(id, "Reference node ID", 80); err != nil {
			return cloudAgentFieldError(fmt.Sprintf("referenceNodeIds[%d]", i), "invalid_value", cloudAgentSafeToolError(err))
		}
	}
	if len(a.ReferenceTransientIDs) > 4 {
		return cloudAgentFieldError("referenceTransientIds", "item_count", "At most 4 temporary reference images; reduce the number of references")
	}
	for i, id := range a.ReferenceTransientIDs {
		if err := validateCloudAgentID(id, "Temporary reference image ID", 120); err != nil {
			return cloudAgentFieldError(fmt.Sprintf("referenceTransientIds[%d]", i), "invalid_value", cloudAgentSafeToolError(err))
		}
	}
	if strings.TrimSpace(a.Prompt) == "" {
		return cloudAgentFieldError("prompt", "required", "The generation prompt must not be empty; provide a complete prompt")
	}
	if strings.TrimSpace(a.Title) == "" || utf8.RuneCountInString(a.Title) > 240 {
		return cloudAgentFieldError("title", "invalid_value", "The generation node title must not be empty or longer than 240 characters")
	}
	if utf8.RuneCountInString(a.Prompt) > 16000 {
		return cloudAgentFieldError("prompt", "length_exceeded", fmt.Sprintf("The prompt has %d characters, over the 16000 character limit; tell the user first and do not cut key content on your own", utf8.RuneCountInString(a.Prompt)))
	}
	if a.Duration < 0 {
		return cloudAgentFieldError("durationSeconds", "invalid_value", "Generation duration cannot be negative; pass a non-negative integer")
	}
	switch mode {
	case "video":
		// 0 means omitted. The selected model's capability defaults are resolved
		// during task admission; an explicit unsupported value still fails there.
	case "image", "audio":
		if a.Duration != 0 {
			return cloudAgentFieldError("durationSeconds", "invalid_value", "Only video generation accepts durationSeconds; omit it for image or audio generation")
		}
		if a.VideoGenerateAudio != nil || a.VideoWatermark != nil || a.VideoArkPrivateAssetUpload != nil {
			return cloudAgentFieldError("videoGenerateAudio", "invalid_value", "Video parameters apply only to video generation; omit them for image or audio generation")
		}
	}
	if len(a.ReferenceNodeIDs) > 16 {
		return cloudAgentFieldError("referenceNodeIds", "item_count", "At most 16 reference nodes; reduce the number of references")
	}
	if a.SourceNodeID != "" {
		for i, id := range a.ReferenceNodeIDs {
			if id == a.SourceNodeID {
				return cloudAgentFieldError(fmt.Sprintf("referenceNodeIds[%d]", i), "duplicate", "sourceNodeId and referenceNodeIds must not overlap; media assets go only in referenceNodeIds and the text source only in sourceNodeId")
			}
		}
	}
	if state == nil {
		return BadAuthRequest("Invalid Agent state")
	}
	return nil
}

func validateCloudAgentMediaBudget(a cloudAgentMediaArgs, state *cloudAgentRuntime) error {
	if state.Request.Budget.MaxGenerationTasks > 0 && state.Generations >= state.Request.Budget.MaxGenerationTasks {
		return BadAuthRequest("This run's media generation limit has been reached")
	}
	if a.Mode == "video" && state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds-a.Duration {
		return BadAuthRequest("This run's video duration budget has been exceeded")
	}
	return nil
}

func validateCloudAgentMediaReferences(mode string, refs map[string]any) error {
	imageCount := lenAnySlice(refs["referenceImages"])
	videoCount := lenAnySlice(refs["referenceVideos"])
	audioCount := lenAnySlice(refs["referenceAudios"])
	switch mode {
	case "image":
		if videoCount > 0 || audioCount > 0 {
			return cloudAgentFieldError("referenceNodeIds", "invalid_combination", "Image generation only supports image reference assets; remove video or audio references")
		}
	case "audio":
		if videoCount > 0 {
			return cloudAgentFieldError("referenceNodeIds", "invalid_combination", "Audio generation cannot use reference videos; remove video references")
		}
		if imageCount > 0 && audioCount > 0 {
			return cloudAgentFieldError("referenceNodeIds", "invalid_combination", "Reference images and reference audio cannot be used together; keep only one media type")
		}
		if imageCount > 1 {
			return cloudAgentFieldError("referenceNodeIds", "item_count", "Audio generation uses at most 1 reference image; reduce image references")
		}
		if audioCount > 3 {
			return cloudAgentFieldError("referenceNodeIds", "item_count", "Audio generation uses at most 3 reference audio clips; reduce audio references")
		}
	case "video":
		// Video reference admission is completed against the selected model's
		// capability contract by CreateTask. Do not guess a provider operation here.
	default:
		return cloudAgentFieldError("mode", "invalid_value", "This generation mode has no media task adapter yet; use a mode listed in the tool schema")
	}
	return nil
}

func lenAnySlice(value any) int {
	switch items := value.(type) {
	case []any:
		return len(items)
	case []map[string]any:
		return len(items)
	default:
		return 0
	}
}

func cloudAgentMediaOperation(mode string, refs map[string]any) string {
	switch mode {
	case "video":
		if lenAnySlice(refs["referenceVideos"]) > 0 {
			return "reference_to_video"
		}
		if lenAnySlice(refs["referenceAudios"]) > 0 {
			return "audio_to_video"
		}
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_video"
		}
	case "image":
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_image"
		}
	}
	if mode == "image" || mode == "video" || mode == "audio" {
		return "text_to_" + mode
	}
	return ""
}

func (s *Service) fillCloudAgentMediaSnapshotHash(userID, canvasID string, a *cloudAgentMediaArgs) error {
	if a == nil || strings.TrimSpace(a.SnapshotHash) != "" {
		return nil
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	a.SnapshotHash = cloudAgentMediaContentHash(doc)
	return nil
}

// prepareCloudAgentMedia 根据当前运行、画布快照和工具调用解析生成参数及素材。
// 返回待审批的任务请求、草稿计划或校验错误；此阶段不提交收费任务。
func (s *Service) prepareCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (CreateTaskRequest, *cloudAgentMediaPlan, error) {
	var a cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &a); err != nil {
		return CreateTaskRequest{}, nil, cloudAgentJSONArgumentError(err)
	}
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	if cloudAgentModelSelectionProvided(call.Function.Arguments) || run == nil || state == nil {
		if err := validateCloudAgentModelSelection(call.Function.Arguments, a); err != nil {
			return CreateTaskRequest{}, nil, err
		}
	}
	if run == nil || state == nil {
		return CreateTaskRequest{}, nil, BadAuthRequest("Invalid Agent state")
	}
	if a.NodeID == "" {
		if call.ID == "" {
			return CreateTaskRequest{}, nil, cloudAgentFieldError("nodeId", "required", "Tool call identity missing; the generation node cannot be created")
		}
		a.NodeID = cloudAgentID(run.UserID, run.ID+":media-node:"+call.ID)
	}
	titleOmitted := a.Title == ""
	if titleOmitted {
		a.Title = map[string]string{"image": "Image", "video": "Video", "audio": "Audio"}[a.Mode]
	}
	a.DraftRunID = run.ID
	if state.Approval != nil && state.Approval.Prepared != nil &&
		state.Approval.CallHash == cloudAgentApprovalCallHash(call) {
		a.Prepared = state.Approval.Prepared
	} else if state.AutoPreparedMedia != nil &&
		state.AutoPreparedCallHash == cloudAgentApprovalCallHash(call) &&
		time.Now().Before(state.AutoPreparedMedia.Quote.ExpiresAt) {
		a.Prepared = state.AutoPreparedMedia
	}
	if err := s.fillCloudAgentMediaSnapshotHash(run.UserID, state.Request.CanvasID, &a); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if err := validateCloudAgentMediaShape(a, state); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	canvas, doc, refs, err := cloudAgentMediaDocument(s.repo, run.UserID, state.Request.CanvasID, a, state.TransientReferences)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if a.Prepared == nil && state.Approval == nil {
		if err := s.resolveCloudAgentMediaConfiguration(&a, state, call.Function.Arguments, doc, refs); err != nil {
			return CreateTaskRequest{}, nil, err
		}
		if titleOmitted {
			for _, node := range creationMaps(doc["nodes"]) {
				if stringValue(node["id"]) == a.NodeID && stringValue(node["title"]) != "" {
					a.Title = stringValue(node["title"])
				}
			}
		}
	}
	// Validate materialized values as well as the original tool shape.
	if err := validateCloudAgentMediaShape(a, state); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if err := validateCloudAgentMediaBudget(a, state); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	characters, err := cloudAgentMediaCharacters(s.repo, run.UserID, canvas.ProjectID, doc, a)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	a.CharacterVersions = map[string]string{}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if character := characters[id]; character != nil {
			a.CharacterVersions[id] = character.Card.VersionID
			a.CharacterLabels = append(a.CharacterLabels, fmt.Sprintf("%s (version %d)", character.Name, character.Card.Version))
		}
	}
	if a.Prepared != nil {
		a.Prompt = stringValue(a.Prepared.Input["prompt"])
	} else {
		for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
			if character := characters[id]; character != nil {
				if text := character.prompt(); text != "" {
					a.Prompt += "\n\n" + text
				}
			}
		}
		if utf8.RuneCountInString(a.Prompt) > 16000 {
			return CreateTaskRequest{}, nil, BadAuthRequest("Character card profiles plus the generation prompt exceed 16000 characters; shorten them and submit again")
		}
		a.Prompt, err = cloudAgentMediaReferencePrompt(a.Prompt, refs)
		if err != nil {
			return CreateTaskRequest{}, nil, err
		}
	}
	spec, err := cloudAgentGenerationSpec(a, refs, nil)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	config := spec.Options.TaskConfig()
	if a.ChannelID != "" {
		config["channelId"], config["channelModelKey"], config["model"] = a.ChannelID, a.ChannelModelKey, a.ChannelModelKey
	}
	if a.Mode == "video" && a.VideoArkPrivateAssetUpload != nil {
		config["videoArkPrivateAssetUpload"] = strconv.FormatBool(*a.VideoArkPrivateAssetUpload)
	}
	metadata := map[string]any{"nodeId": a.NodeID, "source": "cloud_agent"}
	// 首尾帧是结构化输入，不能只写进提示词；复用画布提交任务时的字段。
	if a.VideoStartFrameNodeID != "" {
		metadata["videoStartFrameNodeId"] = a.VideoStartFrameNodeID
	}
	if a.VideoEndFrameNodeID != "" {
		metadata["videoEndFrameNodeId"] = a.VideoEndFrameNodeID
	}
	if len(a.CharacterVersions) > 0 {
		resolvedVersions := make([]string, 0, len(a.CharacterVersions))
		for id, versionID := range a.CharacterVersions {
			resolvedVersions = append(resolvedVersions, id+":"+versionID)
		}
		metadata["resolvedCharacterVersions"] = resolvedVersions
	}
	if a.Mode == "audio" {
		for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
			character := characters[id]
			if character == nil || character.Card.Voice == nil {
				continue
			}
			voice := character.Card.Voice
			voiceKey := strings.TrimSpace(voice.Profile.VoiceKey)
			if voiceKey == "" {
				continue
			}
			if strings.TrimSpace(stringValue(config["audioVoice"])) == "" {
				config["audioVoice"] = voiceKey
			}
			if strings.TrimSpace(stringValue(config["audioInstructions"])) == "" && strings.TrimSpace(voice.Instructions) != "" {
				config["audioInstructions"] = truncateRunes(voice.Instructions, 2000)
			}
			metadata["resolvedCharacterVoiceKey"] = voiceKey
			break
		}
	}
	input := refs
	input["mode"], input["prompt"], input["config"] = a.Mode, a.Prompt, config
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	operation := cloudAgentMediaOperation(a.Mode, refs)
	if operation == "" {
		return CreateTaskRequest{}, nil, BadAuthRequest("This generation mode has no media task adapter yet")
	}
	if a.Mode == "video" {
		metadata["videoEditOperation"] = operation
	}
	input["metadata"] = metadata
	transientSnapshot := map[string]cloudAgentTransientReference{}
	for id, ref := range state.TransientReferences {
		transientSnapshot[id] = ref
	}
	return CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_" + a.Mode, Operation: operation, Prompt: a.Prompt, LogicalModelID: a.LogicalModelID, Model: a.ChannelModelKey, Input: input}, &cloudAgentMediaPlan{Args: a, CallID: call.ID, TransientReferences: transientSnapshot, Prepared: a.Prepared}, nil
}

// applyCloudAgentResolvedMediaDefaults makes the result of the dry admission
// explicit in both the plan and the request that will be submitted. The
// regular task admission already owns default resolution; this helper only
// mirrors that resolved contract back to the Agent state so auto execution does
// not need to fail once for size/duration and then ask the model to repair it.
func applyCloudAgentResolvedMediaDefaults(req *CreateTaskRequest, plan *cloudAgentMediaPlan, task *model.Task) error {
	if req == nil || plan == nil || task == nil {
		return BadAuthRequest("Invalid media generation admission result; no generation task was submitted")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	config, ok := input["config"].(map[string]any)
	if !ok {
		return BadAuthRequest("Media generation could not resolve a model configuration; no generation task was submitted")
	}
	// Compare against intent, not req.Input: task admission may normalize that
	// map in place. Never erase an explicit or inherited choice before checking.
	requested := cloudAgentMediaOptions(plan.Args).TaskConfig()
	if plan.Args.VideoArkPrivateAssetUpload != nil {
		requested["videoArkPrivateAssetUpload"] = strconv.FormatBool(*plan.Args.VideoArkPrivateAssetUpload)
	}
	if err := validateCloudAgentResolvedMediaOptions(requested, input); err != nil {
		return err
	}

	plan.Args.Size = stringValue(config["size"])
	if plan.Args.Mode == "image" {
		plan.Args.Quality = stringValue(config["quality"])
		plan.Args.ImageResolution = stringValue(config["imageResolution"])
	}
	if plan.Args.Mode == "video" {
		plan.Args.Quality = stringValue(config["vquality"])
		if raw := stringValue(config["videoSeconds"]); raw != "" {
			seconds, err := strconv.Atoi(raw)
			if err != nil || seconds < 0 {
				return BadAuthRequest("The model catalog returned an invalid default video duration; no generation task was submitted")
			}
			plan.Args.Duration = seconds
		}
		if raw := stringValue(config["videoGenerateAudio"]); raw != "" {
			audio, err := strconv.ParseBool(raw)
			if err != nil {
				return BadAuthRequest("The model catalog returned invalid default audio parameters; no generation task was submitted")
			}
			plan.Args.VideoGenerateAudio = &audio
		}
		if raw := stringValue(config["videoWatermark"]); raw != "" {
			watermark, err := strconv.ParseBool(raw)
			if err != nil {
				return BadAuthRequest("The model catalog returned an invalid default watermark parameter; no generation task was submitted")
			}
			plan.Args.VideoWatermark = &watermark
		}
		if raw := stringValue(config["videoArkPrivateAssetUpload"]); raw != "" {
			privateUpload, err := strconv.ParseBool(raw)
			if err != nil {
				return BadAuthRequest("The model catalog returned an invalid default reference sync parameter; no generation task was submitted")
			}
			plan.Args.VideoArkPrivateAssetUpload = &privateUpload
		}
	}
	plan.Args.Prepared = nil
	req.Input = input
	req.Prompt = stringValue(input["prompt"])
	return nil
}

func saveCloudAgentDocument(repo *repository.Repository, project *model.CanvasProject, doc map[string]any, policy RuntimePolicySetting) error {
	doc["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if len(raw) > 8<<20 {
		return BadAuthRequest("Canvas size limit exceeded")
	}
	usage, err := repo.UserStorageUsage(project.UserID)
	if err != nil {
		return err
	}
	if err = validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, int64(len(raw)-len(project.PayloadJSON)), policy.Resource); err != nil {
		return err
	}
	beforeDoc, err := creationDocument(project.PayloadJSON)
	if err != nil {
		return err
	}
	operations := canvas.DiffCanvasDocuments(beforeDoc, doc)
	if len(operations) == 0 {
		return nil
	}
	baseRevision := project.Revision
	request := canvas.CanvasOperationsRequest{BaseRevision: &baseRevision, Operations: operations, TrustedServerMutation: true}
	request.MutationID = "agent-canvas:" + project.ID + ":" + canvas.CanvasOperationsDigest(request)
	_, err = canvas.New(repo, nil).ApplyUserCanvasOperations(project.UserID, project.ID, request)
	if err != nil {
		return err
	}
	latest, err := repo.CanvasProjectForUser(project.UserID, project.ID)
	if err != nil {
		return err
	}
	*project = *latest
	persistedDoc, err := creationDocument(latest.PayloadJSON)
	if err != nil {
		return err
	}
	for key := range doc {
		delete(doc, key)
	}
	for key, value := range persistedDoc {
		doc[key] = value
	}
	return nil
}

func rebaseCloudAgentDocument(base, desired, latest map[string]any) map[string]any {
	result := make(map[string]any, len(latest))
	for key, value := range latest {
		result[key] = value
	}
	for _, key := range []string{"nodes", "connections"} {
		result[key] = rebaseCloudAgentCollection(base[key], desired[key], latest[key])
	}
	for key, value := range desired {
		if key == "nodes" || key == "connections" || key == "revision" || key == "updatedAt" || key == "createdAt" || key == "id" {
			continue
		}
		if !jsonValuesEqual(base[key], value) {
			result[key] = value
		}
	}
	return result
}

func rebaseCloudAgentCollection(baseValue, desiredValue, latestValue any) []map[string]any {
	baseItems, desiredItems, latestItems := creationMaps(baseValue), creationMaps(desiredValue), creationMaps(latestValue)
	baseByID, desiredByID := map[string]map[string]any{}, map[string]map[string]any{}
	for _, item := range baseItems {
		baseByID[stringValue(item["id"])] = item
	}
	for _, item := range desiredItems {
		desiredByID[stringValue(item["id"])] = item
	}
	result := make([]map[string]any, 0, len(latestItems)+len(desiredItems))
	seen := map[string]bool{}
	for _, item := range latestItems {
		id := stringValue(item["id"])
		if desired, changed := desiredByID[id]; changed && !jsonValuesEqual(baseByID[id], desired) {
			result = append(result, desired)
		} else if _, removed := baseByID[id]; !removed || desiredByID[id] != nil {
			result = append(result, item)
		}
		seen[id] = true
	}
	for _, item := range desiredItems {
		id := stringValue(item["id"])
		if !seen[id] && !jsonValuesEqual(baseByID[id], item) {
			result = append(result, item)
		}
	}
	return result
}

func jsonValuesEqual(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

// createCloudAgentMediaNode 为指定用户的画布保存计划中的媒体节点及引用连线。
// task 为空时保存待审批草稿，否则绑定已创建任务；policy 校验配额，recorder 可记录撤销事件。
// 返回保存错误；提交生成时由调用方放在任务、计费和 Agent 检查点的同一个事务中执行。
func createCloudAgentMediaNode(repo *repository.Repository, userID, canvasID string, plan *cloudAgentMediaPlan, task *model.Task, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) error {
	a := plan.Args
	canvas, doc, refs, err := cloudAgentMediaDocument(repo, userID, canvasID, a, plan.TransientReferences)
	if err != nil {
		return err
	}
	beforeJSON := canvas.PayloadJSON
	beforeHash := cloudAgentCanvasHash(doc)
	nodes := creationMaps(doc["nodes"])
	x, y := 80.0, 80.0
	for _, node := range nodes {
		position, _ := node["position"].(map[string]any)
		nx, _ := position["x"].(float64)
		width, _ := node["width"].(float64)
		if nx+width+80 > x {
			x = nx + width + 80
		}
		if stringValue(node["id"]) == a.SourceNodeID {
			y, _ = position["y"].(float64)
		}
	}
	var input struct {
		Config map[string]any `json:"config"`
	}
	if task != nil {
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return err
		}
	}
	spec, err := cloudAgentGenerationSpec(a, refs, input.Config)
	if err != nil {
		return err
	}
	meta, err := spec.NodeMetadata()
	if err != nil {
		return err
	}
	meta["status"], meta["agentDraftRunId"], meta["referenceNodeIds"] = "idle", a.DraftRunID, a.ReferenceNodeIDs
	if a.Mode == "video" {
		meta["videoStartFrameNodeId"], meta["videoEndFrameNodeId"] = a.VideoStartFrameNodeID, a.VideoEndFrameNodeID
	}
	meta["prompt"] = cloudAgentMediaComposerPrompt(a.Prompt, refs)
	meta["composerContent"] = meta["prompt"]
	if task != nil {
		meta["status"], meta["taskId"], meta["taskStatus"] = "loading", task.ID, "queued"
		delete(meta, "agentDraftRunId")
	}
	descriptor, supported := cloudAgentNodeCapabilityForGenerationMode(a.Mode)
	if !supported || !cloudAgentGenerationModeSupported(a.Mode) {
		return BadAuthRequest("This generation mode is not supported by the Agent yet")
	}
	node := creationAddedNode(CreationCanvasOp{Type: "add_node", ID: a.NodeID, NodeType: descriptor.Type, Title: a.Title, X: &x, Y: &y, Metadata: meta})
	if a.Size == "9:16" {
		node["width"], node["height"] = float64(360), float64(640)
	}
	replaced := false
	for _, existing := range nodes {
		if stringValue(existing["id"]) == a.NodeID {
			existing["metadata"] = meta
			if task == nil {
				existing["title"] = a.Title
			}
			replaced = true
			break
		}
	}
	if !replaced {
		nodes = append(nodes, node)
	}
	doc["nodes"] = nodes
	edges := cloudAgentMediaConnections(creationMaps(doc["connections"]), a)
	seen := map[string]bool{}
	for _, edge := range edges {
		if stringValue(edge["toNodeId"]) == a.NodeID {
			seen[stringValue(edge["fromNodeId"])] = true
		}
	}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		edges = append(edges, map[string]any{"id": "agent-" + newID(), "fromNodeId": id, "toNodeId": a.NodeID})
	}
	// Reused drafts may already contain only a subset of the new references.
	// Reorder after adding missing edges so chip numbers match submitted arrays.
	doc["connections"] = cloudAgentMediaConnections(edges, a)
	if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
		return err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		stepID := plan.CallID
		if stepID == "" {
			stepID = a.NodeID
		}
		operation := "generate_media_draft"
		preview := cloudAgentMediaApprovalPreview(plan, "")
		if task != nil {
			operation = "generate_media_submit"
			preview = cloudAgentMediaSubmittedPreview(preview)
		}
		return recorder[0](repo, cloudAgentMutationInput{
			RunID:              a.DraftRunID,
			UserID:             userID,
			CanvasID:           canvasID,
			StepID:             stepID,
			Operation:          operation,
			BeforeSnapshotHash: beforeHash,
			AfterSnapshotHash:  cloudAgentCanvasHash(doc),
			BeforeJSON:         beforeJSON,
			HasSubmittedTask:   task != nil,
			Preview:            &preview,
		})
	}
	return nil
}

type cloudAgentMediaWritebackError struct {
	error
	reason string
}

func (e *cloudAgentMediaWritebackError) Unwrap() error { return e.error }

func completeCloudAgentMediaNode(repo *repository.Repository, userID, canvasID, targetNodeID string, task *model.Task, policy RuntimePolicySetting) (string, error) {
	if validateCloudAgentID(targetNodeID, "Generation node ID", 80) != nil {
		return "", &cloudAgentMediaWritebackError{error: creationConflict("The task has no valid target node record; the canvas was not updated"), reason: "target_node_unknown"}
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", &cloudAgentMediaWritebackError{error: creationConflict("The target canvas does not exist or is no longer accessible; task status was not written back"), reason: "canvas_unavailable"}
		}
		return "", err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return "", err
	}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != targetNodeID {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		if stringValue(meta["taskId"]) != task.ID {
			return "", &cloudAgentMediaWritebackError{error: creationConflict("The target node's task binding changed; existing content was not overwritten"), reason: "task_binding_changed"}
		}
		meta["taskStatus"] = string(task.Status)
		meta["status"] = "error"
		meta["errorDetails"] = cloudAgentSafeMediaTaskError(task)
		if task.Status == model.TaskStatusSucceeded {
			id, _ := taskOutputResource(task.ResultJSON, task.Type)
			resource, e := repo.ResourceForUser(userID, id)
			if e != nil || resource.Status != "ready" || !strings.HasPrefix(resource.MimeType, stringValue(node["type"])+"/") {
				meta["status"] = "error"
				meta["errorDetails"] = "The generation result has no usable account resource; no media URL was written"
				if saveErr := saveCloudAgentDocument(repo, canvas, doc, policy); saveErr != nil {
					return stringValue(node["id"]), saveErr
				}
				return stringValue(node["id"]), &cloudAgentMediaWritebackError{error: BadAuthRequest("The generation result has no usable account resource; no media URL was written"), reason: "result_resource_unavailable"}
			}
			meta["content"], meta["storageKey"], meta["status"] = resourceFileURL(id), "resource:"+id, "success"
			// 完成交易已登记的首个产物，与 Agent 回写的首个资源共用身份。
			assetID := generationMediaAssetID(task.ID, 0)
			delete(meta, "assetId")
			if _, err := repo.AssetForUser(userID, assetID); err == nil {
				meta["assetId"] = assetID
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return "", err
			}
			meta["naturalWidth"], meta["naturalHeight"] = resource.Width, resource.Height
			if resource.Width > 0 && resource.Height > 0 {
				if width, ok := node["width"].(float64); ok && width > 0 {
					node["height"] = width * float64(resource.Height) / float64(resource.Width)
				}
			}
			delete(meta, "errorDetails")
		}
		return stringValue(node["id"]), saveCloudAgentDocument(repo, canvas, doc, policy)
	}
	return "", &cloudAgentMediaWritebackError{error: creationConflict("The target generation node does not exist and was not recreated; the task record remains in the task center"), reason: "target_node_missing"}
}
