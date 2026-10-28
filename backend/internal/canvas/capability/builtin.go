package capability

import "yingce/backend/internal/canvas/contract"

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
	// 坐标绝对值上限：与 app 侧整理工具收敛几何值的范围一致。
	maxAgentNodeCoordLimit = 1e6
)

func BuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "Text", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:     "Holds plain notes, creative drafts and single prompts.",
			GoodFor:     []string{"A single idea", "One-off prompts", "Temporary notes", "Quick experiments"},
			NotIdealFor: []string{"Multi-shot scripts", "Content edited shot by shot", "Content that needs shot-level asset links"},
			Tradeoffs:   []string{"Lightest to create and edit", "No shot-level fields or per-shot maintenance"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Body", "Node body text"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "status": "idle", "fontSize": float64(14)}
			},
		},
		{
			Type: "markdown", Version: "1", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "Holds human-readable plans, script drafts and formatted documents.",
			GoodFor:     []string{"Creative plans", "Script drafts", "Delivery documents", "Long text that needs formatting"},
			NotIdealFor: []string{"Multi-shot content generated or reviewed shot by shot", "Structured workflows bound to media assets"},
			Tradeoffs:   []string{"Good for reading and export", "Little structure; cannot replace a maintainable storyboard"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Markdown body", "Markdown body"),
		},
		{
			Type: "file", Version: "1", Label: "Text file", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "Holds TXT, Markdown or other files uploaded to the canvas; read the body with canvas_read_text within the current user's permissions.",
			GoodFor:     []string{"Reading an uploaded novel or script", "Keeping the original file as the adaptation source"},
			NotIdealFor: []string{"Image, video or audio references", "Structured storyboards maintained shot by shot"},
			Tradeoffs:   []string{"File body is read on demand and returned in pages", "Binary files are not parsed as text"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true},
			SummaryFields: []string{"mimeType"}, DetailFields: []string{"mimeType"},
		},
		generatedMediaDescriptor("image", "2", "Image", 720, 405, "image", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "character"},
		}),
		generatedMediaDescriptor("video", "2", "Video", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio", "character"},
		}),
		generatedMediaDescriptor("audio", "2", "Audio", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text", "character"},
		}),
		characterDescriptor(),
		{
			Type: "frame", Version: "1", Label: "Backdrop", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "Creates a movable, collapsible visual area on the canvas to group related nodes; the backdrop itself holds no creative text or generated results.",
			GoodFor:       []string{"Grouping scripts, reference images and results by scene or shot group", "Splitting the workspace into stages such as planning, production and delivery", "Giving large canvases clear areas so whole groups can be moved or collapsed"},
			NotIdealFor:   []string{"Holding structured shot data (use a storyboard node)", "Storing text the Agent reads or writes on its own (use a text or Markdown node)", "Replacing specific content nodes or media generation nodes"},
			Tradeoffs:     []string{"Improves spatial organization but adds no content structure or generation ability"},
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
		{
			Type: "batch-table", Version: "1", Label: "Batch table", DefaultWidth: 1280, DefaultHeight: 560,
			Purpose:     "Structured task table for e-commerce batch try-on and creative image generation; each row binds up to six canvas images and can have its own prompt using positional references such as @参考图1, or a global prompt can override every row; generation results are tracked.",
			GoodFor:     []string{"Batch try-on of products on models", "Creative images of one product in many scenes", "Generation from combinations of reference image sets", "Tracking batch results and retrying failures"},
			NotIdealFor: []string{"General database or inventory management", "Quick single-image experiments", "Multi-shot narrative continuity"},
			Tradeoffs:   []string{"Reference images must first be on the canvas as image nodes", "Batch submission creates many generation tasks; confirm model, count and cost before running"},
			Actions:     []string{"read_rows", "append_row", "update_row", "remove_row", "set_operation", "set_concurrency", "add_reference_column", "remove_reference_column", "set_global_prompt", "preview_batch_generation"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image"}},
			CanUpdate:   true, SummaryFields: []string{"batchTable"}, DetailFields: []string{"batchTable"}, ProjectionKind: "batch_table", ProjectionField: "batchTable",
			PatchFields: func() map[string]PatchField {
				fields := map[string]PatchField{
					"title": {Path: "title", Kind: patchKindString, Label: "Node name", Order: 10, Description: "Batch table title", MaxRunes: maxAgentNodeTitleRunes},
				}
				for key, field := range positionPatchFields() {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{
					"status": "idle",
					"batchTable": map[string]any{
						"operation": "try_on", "concurrency": float64(10),
						"referenceColumns": []any{
							map[string]any{"id": "reference-1", "label": "Reference 1"},
							map[string]any{"id": "reference-2", "label": "Reference 2"},
							map[string]any{"id": "reference-3", "label": "Reference 3"},
						},
						"rows": []any{},
					},
				}
			},
		},
		{
			Type: "script", Version: "1", Label: "Storyboard", DefaultWidth: 920, DefaultHeight: 360,
			Purpose:       "Maintains a structured multi-shot script with shot-level review, editing and media links.",
			GoodFor:       []string{"Multi-shot planning", "Shot continuity", "Shot-by-shot review and fine-tuning", "Generating images or videos shot by shot", "Content others will take over and maintain"},
			NotIdealFor:   []string{"Quick experiments with a single frame", "One-off temporary prompts", "Plain documents that only need readable formatting"},
			Tradeoffs:     []string{"Higher upfront entry cost than a text node", "but keeps shot-level structure, asset links and later maintainability"},
			Actions:       []string{"read_rows", "append_row", "update_row", "remove_row", "generate_storyboard", "connect_assets", "update_node"},
			InputKind:     "text",
			Connection:    ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"audio", "character", "image", "text", "video"}},
			CanUpdate:     true,
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			PatchFields: titleAndPositionPatchFields(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

// characterDescriptor 是角色卡能力：画布上是 text + metadata.workflowKind=character 的节点，
// 设定、三视图与声音都来自账号内的角色资产而非节点正文。它可以被发现、精读、连线和引用，
// 但不能用 add_node 凭空创建：必须经 canvas_create_character 用真实图片/音频建角色资产，名称和设定只随角色资产更新。
func characterDescriptor() Descriptor {
	return Descriptor{
		Type: "character", Version: "1", Label: "Character card", DefaultWidth: 264, DefaultHeight: 352,
		Purpose:     "References a character asset from the account's character library, providing its profile, turnaround/look images and bound voice together to keep the character consistent across generations.",
		GoodFor:     []string{"Locking a character's look in image or video generation", "Keeping one character consistent across shots", "Using the bound voice for character dialogue", "Using only the character's written profile as a prompt source"},
		NotIdealFor: []string{"Temporary one-off character descriptions (write them in the prompt or a text node)", "Creating with add_node (use canvas_create_character to bundle look images and voice)", "Holding plain body text (node body is not the character profile)"},
		Tradeoffs:   []string{"Profile and media follow the character asset version; the version is checked on submit", "Without a bound look or voice the matching reference is unavailable; read character.imageReference/audioReference first"},
		Actions:     []string{"read_character", "use_as_reference", "use_as_text_source"},
		InputKind:   "character",
		Connection:  ConnectionPolicy{CanSource: true, CanReference: true},
		CanUpdate:   true,
		PatchFields: positionPatchFields(),
		Variant:     &NodeVariant{BaseType: "text", WorkflowKind: "character"},
	}
}

// generatedMediaDescriptor 根据节点类型、显示尺寸、生成模式和连接规则创建媒体能力描述。
// 返回读写字段及创建默认值；首尾帧只对视频开放，避免其他节点接受无效视频参数。
func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	semantics := generatedMediaSemantics(nodeType)
	fields := editableNodeFields("metadata.generationSpec.prompt", "Prompt", "Current prompt in the generation contract; this is the only media prompt the Agent reads and writes")
	readFields := []string{"prompt", "assetTags", "referenceNodeIds"}
	if generationMode == "video" {
		for i, frame := range []struct{ key, label string }{
			{"videoStartFrameNodeId", "First frame"}, {"videoEndFrameNodeId", "Last frame"},
		} {
			fields[frame.key] = PatchField{Path: "metadata." + frame.key, Kind: patchKindString, Label: frame.label, Order: 40 + i, MaxRunes: 80, Description: "Connected image ID; an empty string clears it"}
			readFields = append(readFields, frame.key)
		}
	}
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		Purpose: semantics.Purpose, GoodFor: semantics.GoodFor, NotIdealFor: semantics.NotIdealFor,
		Tradeoffs: semantics.Tradeoffs, Actions: semantics.Actions,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  readFields,
		DetailFields:   readFields,
		PatchFields:    fields,
		CreateMetadata: func(prompt string) map[string]any { return generatedMetadata(generationMode, prompt) },
	}
}

type generatedMediaCapabilitySemantics struct {
	Purpose     string
	GoodFor     []string
	NotIdealFor []string
	Tradeoffs   []string
	Actions     []string
}

func generatedMediaSemantics(nodeType string) generatedMediaCapabilitySemantics {
	switch nodeType {
	case "image":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generates or holds one still image and serves as a real reference for later image or video generation.",
			GoodFor:     []string{"Single image generation", "Image generation with reference images", "Storyboard first frames and keyframes", "Visual assets to reuse"},
			NotIdealFor: []string{"Holding a multi-shot script structure", "Expressing camera movement or change over time", "Replacing a storyboard for shot continuity"},
			Tradeoffs:   []string{"One node per still media target", "Reference count and generation mode must still match the model catalog capabilities"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "video":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generates or holds one continuous video clip; runs text-to-video, image-to-video or multi-image video depending on the actual references.",
			GoodFor:     []string{"Single-shot text-to-video", "Single image-to-video", "Video from multiple reference images", "Video generation using existing video or audio"},
			NotIdealFor: []string{"Holding a whole multi-shot script", "Using one node instead of shot-by-shot review and maintenance", "Assuming any reference count is supported without checking model capabilities"},
			Tradeoffs:   []string{"One node usually maps to one video clip generated and reviewed on its own", "Reference types and count, duration, aspect ratio, audio and price are bound by the current model catalog"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "audio":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generates or holds one audio asset for voice-over, music, sound effects or video reference input.",
			GoodFor:     []string{"Text to speech", "Voice-over", "Music or sound effect assets", "Audio references for video"},
			NotIdealFor: []string{"Holding storyboard structure", "Expressing composition or camera movement", "Replacing a video node"},
			Tradeoffs:   []string{"One node per audio target, accepting at most one text input", "Audio type, duration and price still follow the model catalog and task admission"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	default:
		return generatedMediaCapabilitySemantics{}
	}
}

func titleAndPositionPatchFields() map[string]PatchField {
	fields := map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "Node name", Order: 10, Description: "Node title", MaxRunes: maxAgentNodeTitleRunes,
		},
	}
	for key, field := range positionPatchFields() {
		fields[key] = field
	}
	return fields
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	fields := titleAndPositionPatchFields()
	fields["content"] = PatchField{
		Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
	}
	return fields
}

// positionPatchFields 是坐标字段：模型可以直接指定节点位置（微调），批量整理走 canvas_arrange_nodes。
// 坐标上限与整理侧的收敛范围一致，避免写进离谱的几何值。
func positionPatchFields() map[string]PatchField {
	return map[string]PatchField{
		"x": {Path: "position.x", Kind: patchKindNumber, Label: "X", Order: 30, Limit: maxAgentNodeCoordLimit, Description: "Canvas x coordinate (pixels); moves the node together with y; usually tidy in bulk with canvas_arrange_nodes"},
		"y": {Path: "position.y", Kind: patchKindNumber, Label: "Y", Order: 31, Limit: maxAgentNodeCoordLimit, Description: "Canvas y coordinate (pixels); moves the node together with x; usually tidy in bulk with canvas_arrange_nodes"},
	}
}

func generatedMetadata(mode, prompt string) map[string]any {
	spec := contract.GenerationSpec{
		Version:           contract.GenerationVersion,
		Mode:              mode,
		Prompt:            prompt,
		Options:           contract.Options{},
		ReferenceBindings: []contract.ReferenceBinding{},
		TextInputMode:     "append-sources",
	}
	metadata, err := spec.NodeMetadata()
	if err != nil {
		panic(err)
	}
	metadata["content"] = ""
	metadata["status"] = "idle"
	return metadata
}
