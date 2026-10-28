package app

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentMediaQuoteLifetime = 30 * time.Minute

type cloudAgentMediaQuote struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Prepared inputs contain public resource selectors, never resolved credentials.
// Re-admission must reproduce the same execution and quote before committing.
type cloudAgentPreparedMedia struct {
	Version            int                  `json:"version"`
	Hash               string               `json:"hash"`
	GenerationID       string               `json:"generationId"`
	DependencyHash     string               `json:"dependencyHash"`
	ResolvedHash       string               `json:"resolvedHash"`
	Quote              cloudAgentMediaQuote `json:"quote"`
	Input              map[string]any       `json:"input,omitempty"`
	ResourceSignatures map[string]string    `json:"resourceSignatures,omitempty"`
	CharacterVersions  map[string]string    `json:"characterVersions,omitempty"`
}

func (p *cloudAgentPreparedMedia) publicView() *cloudAgentPreparedMedia {
	if p == nil {
		return nil
	}
	copy := *p
	copy.Input, copy.ResourceSignatures = nil, nil
	return &copy
}

func cloudAgentApprovalOutput(approval *cloudAgentApproval) *cloudAgentApproval {
	if approval == nil {
		return nil
	}
	copy := *approval
	copy.Prepared = approval.Prepared.publicView()
	return &copy
}

func cloudAgentMediaDependencyHash(doc map[string]any, args cloudAgentMediaArgs) (string, error) {
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return "", err
	}
	projectionNode := func(node map[string]any) (map[string]any, error) {
		metadata, _ := node["metadata"].(map[string]any)
		input, err := contract.NodeGenerationProjection(metadata)
		if err != nil {
			return nil, BadAuthRequest("Invalid generation dependency field: " + err.Error())
		}
		return input, nil
	}
	resourceProjection := func(metadata map[string]any) map[string]any {
		resource := map[string]any{}
		for _, key := range []string{"storageKey", "assetId", "resourceId", "generationTaskId", "outputReference", "status", "mimeType", "naturalWidth", "naturalHeight", "width", "height", "durationMs", "etag", "characterAssetId", "characterVersionId", "characterVersionPolicy"} {
			if value, exists := metadata[key]; exists {
				resource[key] = value
			}
		}
		return resource
	}
	target := nodes[args.NodeID]
	var targetInput any
	if target != nil {
		input, err := projectionNode(target)
		if err != nil {
			return "", err
		}
		metadata, _ := target["metadata"].(map[string]any)
		for _, key := range []string{"locked", "taskId", "generationTaskId", "agentDraftRunId", "status"} {
			input[key] = metadata[key]
		}
		targetInput = map[string]any{"id": target["id"], "type": target["type"], "locked": target["locked"], "input": input, "resource": resourceProjection(metadata)}
	}
	bindings := make([]any, 0, len(args.ReferenceNodeIDs))
	for _, id := range args.ReferenceNodeIDs {
		node := nodes[id]
		binding := map[string]any{"id": id, "exists": node != nil}
		if node != nil {
			input, err := projectionNode(node)
			if err != nil {
				return "", err
			}
			metadata, _ := node["metadata"].(map[string]any)
			binding["type"] = node["type"]
			binding["input"] = input
			binding["resource"] = resourceProjection(metadata)
		}
		bindings = append(bindings, binding)
	}
	var source any
	if args.SourceNodeID != "" {
		node := nodes[args.SourceNodeID]
		metadata, _ := node["metadata"].(map[string]any)
		source = map[string]any{"id": args.SourceNodeID, "type": node["type"], "content": metadata["content"], "prompt": metadata["prompt"], "characterAssetId": metadata["characterAssetId"], "characterVersionId": metadata["characterVersionId"], "characterVersionPolicy": metadata["characterVersionPolicy"]}
	}
	edges := []any{}
	for _, edge := range creationMaps(doc["connections"]) {
		if stringValue(edge["toNodeId"]) == args.NodeID {
			edges = append(edges, map[string]any{"fromNodeId": edge["fromNodeId"], "toNodeId": edge["toNodeId"], "fromPort": edge["fromPort"], "toPort": edge["toPort"], "role": edge["role"]})
		}
	}
	return creationHash(map[string]any{"version": 2, "target": targetInput, "bindings": bindings, "source": source, "edges": edges}), nil
}

func cloudAgentResourceSignature(resource *model.Resource) string {
	return creationHash(map[string]any{"id": resource.ID, "userId": resource.UserID, "provider": resource.Provider, "endpoint": resource.Endpoint, "bucket": resource.Bucket, "objectKey": resource.ObjectKey, "storageSettingId": resource.StorageSettingID, "etag": resource.ETag, "size": resource.Size, "mimeType": resource.MimeType, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs})
}

func cloudAgentPreparedReferences(repo *repository.Repository, userID string, prepared *cloudAgentPreparedMedia) (map[string]any, error) {
	refs := map[string]any{}
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		items := []any{}
		for _, ref := range creationMaps(prepared.Input[field]) {
			id := strings.TrimPrefix(stringValue(ref["storageKey"]), "resource:")
			resource, err := repo.ResourceForUser(userID, id)
			if err != nil || resource.Status != model.ResourceStatusReady || prepared.ResourceSignatures[id] != cloudAgentResourceSignature(resource) {
				return nil, creationConflict("An approved reference resource is no longer valid or no longer belongs to the current user; prepare the generation again. No task was submitted")
			}
			copy := map[string]any{}
			for key, value := range ref {
				copy[key] = value
			}
			items = append(items, copy)
		}
		if len(items) > 0 {
			refs[field] = items
		}
	}
	return refs, nil
}

func cloudAgentResolvedMediaHash(task *model.Task) (string, error) {
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return "", err
	}
	config, _ := input["config"].(map[string]any)
	public := map[string]any{}
	if values, exists := config["imageParameters"]; exists {
		public["imageParameters"] = values
	}
	for _, key := range []string{"channelId", "channelModelKey", "providerModelKey", "priceTierId", "model", "apiFormat", "interfaceType", "capabilityConfig", "size", "imageResolution", "quality", "transparentBackground", "count", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"} {
		if value, exists := config[key]; exists {
			public[key] = value
		}
	}
	return creationHash(map[string]any{"mode": input["mode"], "prompt": input["prompt"], "config": public, "referenceImages": input["referenceImages"], "referenceVideos": input["referenceVideos"], "referenceAudios": input["referenceAudios"], "operation": task.Operation, "logicalModelId": task.LogicalModelID, "logicalModelRevisionId": task.LogicalModelRevisionID, "channelModelId": task.ChannelModelID}), nil
}

func prepareCloudAgentMediaApproval(repo *repository.Repository, userID string, doc map[string]any, plan *cloudAgentMediaPlan, request CreateTaskRequest, task *model.Task) (*cloudAgentPreparedMedia, error) {
	dependency, err := cloudAgentMediaDependencyHash(doc, plan.Args)
	if err != nil {
		return nil, err
	}
	resolved, err := cloudAgentResolvedMediaHash(task)
	if err != nil {
		return nil, err
	}
	prepared := &cloudAgentPreparedMedia{Version: 1, GenerationID: newID(), DependencyHash: dependency, ResolvedHash: resolved, Input: request.Input, ResourceSignatures: map[string]string{}, Quote: cloudAgentMediaQuote{ID: newID(), ExpiresAt: time.Now().UTC().Add(cloudAgentMediaQuoteLifetime)}}
	prepared.CharacterVersions = plan.Args.CharacterVersions
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		for _, ref := range creationMaps(request.Input[field]) {
			key := stringValue(ref["storageKey"])
			if !strings.HasPrefix(key, "resource:") {
				return nil, BadAuthRequest("Generation references must be saved to the resource library first")
			}
			id := strings.TrimPrefix(key, "resource:")
			resource, err := repo.ResourceForUser(userID, id)
			if err != nil || resource.Status != model.ResourceStatusReady {
				return nil, BadAuthRequest("The reference resource is no longer valid")
			}
			prepared.ResourceSignatures[id] = cloudAgentResourceSignature(resource)
		}
	}
	prepared.Hash = creationHash(prepared)
	return prepared, nil
}

func pinCloudAgentPreparedMedia(repo *repository.Repository, userID, runID, approvalID string, prepared *cloudAgentPreparedMedia) error {
	ids := make([]string, 0, len(prepared.ResourceSignatures))
	for id := range prepared.ResourceSignatures {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return repo.UpsertCloudAgentResourceLeases(userID, runID, approvalID, ids, prepared.Quote.ExpiresAt)
}

// cloudAgentPreparedSpecUnchanged 判断这次准入解析出的规格是否就是批准时固定的规格。
func cloudAgentPreparedSpecUnchanged(prepared *cloudAgentPreparedMedia, task *model.Task) bool {
	if prepared == nil || prepared.ResolvedHash == "" || task == nil {
		return false
	}
	hash, err := cloudAgentResolvedMediaHash(task)
	return err == nil && hash == prepared.ResolvedHash
}

// cloudAgentStaleApprovalError 表示批准时的报价、依赖或规格在提交前已经失效。此时还没有
// 创建任务和订单，让 Agent 重新申请审批（仍需用户再次批准）而不是整轮失败；
// 这类失败计入同一工具的自动纠正次数，不会无限重复。
func cloudAgentStaleApprovalError(message, action string) error {
	return &cloudAgentMediaAdmissionError{
		error:          creationConflict(message),
		Reason:         "approval_stale",
		ErrorClass:     cloudAgentToolErrorStateConflict,
		Retryable:      true,
		RequiredAction: action,
	}
}

func validateCloudAgentPreparedAdmission(repo *repository.Repository, userID string, prepared *cloudAgentPreparedMedia, task *model.Task, doc map[string]any, args cloudAgentMediaArgs) error {
	if prepared == nil || prepared.Version != 1 || prepared.Hash == "" {
		return creationConflict("The approved generation preparation is missing; request approval again. No task was submitted")
	}
	if time.Now().After(prepared.Quote.ExpiresAt) {
		return cloudAgentStaleApprovalError("The generation approval expired; call generate_media again to request approval. No task was submitted", "retry")
	}
	dependency, err := cloudAgentMediaDependencyHash(doc, args)
	if err != nil {
		return err
	}
	if dependency != prepared.DependencyHash {
		return cloudAgentStaleApprovalError("The canvas generation dependencies changed; read the canvas again before requesting approval. No task was submitted", "reread_canvas")
	}
	if len(prepared.CharacterVersions) > 0 {
		canvas, err := repo.CanvasProjectForUser(userID, task.ProjectID)
		if err != nil {
			return err
		}
		nodes, err := creationObjects(doc["nodes"])
		if err != nil {
			return err
		}
		for id, versionID := range prepared.CharacterVersions {
			node := nodes[id]
			if node == nil || !cloudAgentCharacterNode(node) {
				return cloudAgentStaleApprovalError("The character card changed; read the canvas again before requesting approval. No task was submitted", "reread_canvas")
			}
			character, err := cloudAgentResolveCharacter(repo, userID, canvas.ProjectID, node)
			if err != nil || character.Card.VersionID != versionID {
				return cloudAgentStaleApprovalError("The character card version changed; read the canvas again before requesting approval. No task was submitted", "reread_canvas")
			}
		}
	}
	hash, err := cloudAgentResolvedMediaHash(task)
	if err != nil {
		return err
	}
	if hash != prepared.ResolvedHash {
		return cloudAgentStaleApprovalError("The model specification or price changed; call generate_media again to request approval. No task was submitted", "retry")
	}
	if _, err := cloudAgentPreparedReferences(repo, userID, prepared); err != nil {
		return err
	}
	return nil
}
