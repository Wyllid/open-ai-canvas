package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/repository"
)

// Previs Agent tools deliberately expose a projection rather than the raw
// PrevisScene payload. The browser owns model URLs and storage references;
// the Agent only needs semantic shot/layout data to plan a preview.
func cloudAgentPrevisSceneRead(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (any, error) {
	var args struct {
		SceneID           string   `json:"sceneId"`
		ShotID            string   `json:"shotId"`
		ObjectIDs         []string `json:"objectIds"`
		IncludeTransforms bool     `json:"includeTransforms"` // Return exact position/rotation/fov for spatial planning
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.SceneID != "" {
		if err := validateCloudAgentID(args.SceneID, "Previs scene ID", 80); err != nil {
			return nil, err
		}
	}
	if args.ShotID != "" {
		if err := validateCloudAgentID(args.ShotID, "Previs shot ID", 80); err != nil {
			return nil, err
		}
		if args.SceneID == "" {
			return nil, cloudAgentFieldError("shotId", "requires_scene", "sceneId is required together with shotId")
		}
	}
	if len(args.ObjectIDs) > 16 {
		return nil, BadAuthRequest("A previs object read can include at most 16 object IDs")
	}
	for _, id := range args.ObjectIDs {
		if err := validateCloudAgentID(id, "Previs object ID", 80); err != nil {
			return nil, err
		}
	}

	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	rawScenes := creationMaps(doc["previsScenes"])
	if args.SceneID == "" {
		items := make([]map[string]any, 0, len(rawScenes))
		for _, scene := range rawScenes {
			items = append(items, map[string]any{
				"id":           stringValue(scene["id"]),
				"title":        truncateRunes(stringValue(scene["title"]), 160),
				"activeShotId": stringValue(scene["activeShotId"]),
				"shotCount":    len(creationMaps(scene["shots"])),
				"objectCount":  len(creationMaps(scene["objects"])),
			})
		}
		return map[string]any{
			"canvasId":           canvasID,
			"canvasSnapshotHash": cloudAgentCanvasHash(doc),
			"scenes":             items,
			"count":              len(items),
			"guidance":           "First read a scene with a returned sceneId, then use shotId for layout or preview. When creating a scene, pass canvasSnapshotHash back unchanged.",
		}, nil
	}

	scene, ok := findPrevisScene(rawScenes, args.SceneID)
	if !ok {
		return nil, BadAuthRequest("The previs scene does not exist or does not belong to this canvas")
	}
	if args.ShotID != "" {
		if _, ok := findPrevisShot(scene, args.ShotID); !ok {
			return nil, BadAuthRequest("The previs shot does not exist or does not belong to the given scene")
		}
	}
	objectIDs := make(map[string]bool, len(args.ObjectIDs))
	for _, id := range args.ObjectIDs {
		objectIDs[id] = true
	}
	projection := projectPrevisScene(scene, args.ShotID, objectIDs)
	if args.IncludeTransforms {
		// Augment with full spatial data for layout planning: object positions, camera transforms, FOV
		projection["spatialLayout"] = cloudAgentPrevisSpatialLayout(scene)
		projection["coordinateGuide"] = "Coordinate system: Y is up, units are meters. A person is about 1.8m tall. position=[X,Y,Z], rotation=[around X, around Y, around Z in radians]. target is the camera focus point."
	}
	return map[string]any{
		"canvasId":           canvasID,
		"scene":              projection,
		"snapshotHash":       creationHash(scene),
		"canvasSnapshotHash": cloudAgentCanvasHash(doc),
		"revision":           canvas.Revision,
		"guidance":           "Safe summary. Change it with previs_apply_patch; preview with previs_preview; for layout planning use includeTransforms=true to get exact coordinates. snapshotHash covers only this scene.",
	}, nil
}

// previsMapSafe safely casts a value to map[string]any, returning an empty map on failure.
func previsMapSafe(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// cloudAgentPrevisSpatialLayout returns precise spatial data for Agent layout planning.
// It never returns model URLs, storage keys, or any other sensitive references.
func cloudAgentPrevisSpatialLayout(scene map[string]any) map[string]any {
	objects := creationMaps(scene["objects"])
	cameras := creationMaps(scene["cameras"])
	shots := creationMaps(scene["shots"])

	objLayouts := make([]map[string]any, 0, len(objects))
	for _, obj := range objects {
		if !boolValue(obj["visible"], true) {
			continue
		}
		transform := previsMapSafe(obj["transform"])
		entry := map[string]any{
			"id":            stringValue(obj["id"]),
			"name":          stringValue(obj["name"]),
			"kind":          stringValue(obj["kind"]),
			"archetype":     stringValue(obj["archetype"]),
			"pose":          stringValue(obj["pose"]),
			"color":         stringValue(obj["color"]),
			"position":      transform["position"],
			"rotation":      transform["rotation"],
			"scale":         transform["scale"],
			"keyframeCount": len(creationMaps(obj["keyframes"])),
			"hasMotionPath": obj["motionPath"] != nil,
		}
		if motions := creationMaps(obj["motions"]); len(motions) > 0 {
			projected := make([]map[string]any, 0, len(motions))
			for _, motion := range motions {
				projected = append(projected, map[string]any{"id": stringValue(motion["id"]), "motion": stringValue(motion["motion"]), "start": motion["start"], "duration": motion["duration"]})
			}
			entry["motions"] = projected
		}
		if binding, ok := obj["characterBinding"].(map[string]any); ok {
			entry["characterBinding"] = map[string]any{
				"characterAssetId":   stringValue(binding["characterAssetId"]),
				"characterVersionId": stringValue(binding["characterVersionId"]),
				"referenceNodeId":    stringValue(binding["referenceNodeId"]),
				"characterName":      truncateRunes(stringValue(binding["characterName"]), 160),
			}
		}
		objLayouts = append(objLayouts, entry)
	}

	camLayouts := make([]map[string]any, 0, len(cameras))
	for _, cam := range cameras {
		transform := previsMapSafe(cam["transform"])
		camLayouts = append(camLayouts, map[string]any{
			"id":          stringValue(cam["id"]),
			"name":        stringValue(cam["name"]),
			"position":    transform["position"],
			"target":      cam["target"],
			"focalLength": cam["focalLength"],
			"fov":         cam["fov"],
		})
	}

	shotLayouts := make([]map[string]any, 0, len(shots))
	for _, shot := range shots {
		shotLayouts = append(shotLayouts, map[string]any{
			"id":         stringValue(shot["id"]),
			"name":       stringValue(shot["name"]),
			"cameraId":   stringValue(shot["cameraId"]),
			"shotSize":   stringValue(shot["shotSize"]),
			"cameraMove": stringValue(shot["cameraMove"]),
			"duration":   shot["duration"],
		})
	}

	return map[string]any{
		"objects": objLayouts,
		"cameras": camLayouts,
		"shots":   shotLayouts,
	}
}

func cloudAgentPrevisPreview(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (any, error) {
	var args struct {
		SceneID  string   `json:"sceneId"`
		ShotID   string   `json:"shotId"`
		Duration *float64 `json:"duration"`
		FPS      *int     `json:"fps"`
		Output   string   `json:"output"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.SceneID, "Previs scene ID", 80); err != nil {
		return nil, err
	}
	if err := validateCloudAgentID(args.ShotID, "Previs shot ID", 80); err != nil {
		return nil, err
	}
	if args.Output != "" && args.Output != "clay_video" {
		return nil, BadAuthRequest("Previs preview output only supports clay_video for now")
	}
	if args.Duration != nil && (*args.Duration < 0.1 || *args.Duration > 60) {
		return nil, BadAuthRequest("Previs preview duration must be between 0.1 and 60 seconds")
	}
	if args.FPS != nil && (*args.FPS < 1 || *args.FPS > 60) {
		return nil, BadAuthRequest("Previs preview fps must be between 1 and 60")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	scene, ok := findPrevisScene(creationMaps(doc["previsScenes"]), args.SceneID)
	if !ok {
		return nil, BadAuthRequest("The previs scene does not exist or does not belong to this canvas")
	}
	shot, ok := findPrevisShot(scene, args.ShotID)
	if !ok {
		return nil, BadAuthRequest("The previs shot does not exist or does not belong to the given scene")
	}
	duration := numberValue(shot["duration"], 5)
	if args.Duration != nil {
		duration = *args.Duration
	}
	fps := int(numberValue(shot["fps"], 24))
	if args.FPS != nil {
		fps = *args.FPS
	}
	requestID := strings.TrimSpace(call.ID)
	if requestID == "" {
		requestID = fmt.Sprintf("previs-preview-%s-%s", args.SceneID, args.ShotID)
	}
	return map[string]any{
		"previewRequestId": requestID,
		"canvasId":         canvasID,
		"sceneId":          args.SceneID,
		"sceneTitle":       truncateRunes(stringValue(scene["title"]), 160),
		"shotId":           args.ShotID,
		"shotName":         truncateRunes(stringValue(shot["name"]), 160),
		"duration":         duration,
		"fps":              fps,
		"output":           "clay_video",
		"snapshotHash":     creationHash(scene),
		"execution":        "browser_previs_viewport",
		"text":             "The previs stage was asked to record a blockout preview in the browser viewport; when recording finishes it is written back as a canvas video node.",
	}, nil
}

func findPrevisScene(scenes []map[string]any, id string) (map[string]any, bool) {
	for _, scene := range scenes {
		if stringValue(scene["id"]) == id {
			return scene, true
		}
	}
	return nil, false
}

func findPrevisShot(scene map[string]any, id string) (map[string]any, bool) {
	for _, shot := range creationMaps(scene["shots"]) {
		if stringValue(shot["id"]) == id {
			return shot, true
		}
	}
	return nil, false
}

func projectPrevisScene(scene map[string]any, shotID string, objectIDs map[string]bool) map[string]any {
	shots := make([]map[string]any, 0)
	for _, shot := range creationMaps(scene["shots"]) {
		if shotID != "" && stringValue(shot["id"]) != shotID {
			continue
		}
		shots = append(shots, map[string]any{
			"id":         stringValue(shot["id"]),
			"name":       truncateRunes(stringValue(shot["name"]), 160),
			"cameraId":   stringValue(shot["cameraId"]),
			"duration":   numberValue(shot["duration"], 5),
			"fps":        int(numberValue(shot["fps"], 24)),
			"shotSize":   stringValue(shot["shotSize"]),
			"cameraMove": stringValue(shot["cameraMove"]),
		})
	}
	objects := make([]map[string]any, 0)
	for _, object := range creationMaps(scene["objects"]) {
		id := stringValue(object["id"])
		if len(objectIDs) > 0 && !objectIDs[id] {
			continue
		}
		objects = append(objects, map[string]any{
			"id":        id,
			"name":      truncateRunes(stringValue(object["name"]), 160),
			"kind":      stringValue(object["kind"]),
			"primitive": stringValue(object["primitive"]),
			"color":     stringValue(object["color"]),
			"pose":      stringValue(object["pose"]),
			"visible":   boolValue(object["visible"], true),
			"transform": projectPrevisTransform(object["transform"]),
		})
	}
	cameras := make([]map[string]any, 0)
	for _, camera := range creationMaps(scene["cameras"]) {
		cameras = append(cameras, map[string]any{
			"id":          stringValue(camera["id"]),
			"name":        truncateRunes(stringValue(camera["name"]), 160),
			"focalLength": numberValue(camera["focalLength"], 50),
			"transform":   projectPrevisTransform(camera["transform"]),
			"target":      projectPrevisVec3(camera["target"]),
		})
	}
	return map[string]any{
		"id":           stringValue(scene["id"]),
		"title":        truncateRunes(stringValue(scene["title"]), 160),
		"activeShotId": stringValue(scene["activeShotId"]),
		"shots":        shots,
		"objects":      objects,
		"cameras":      cameras,
		"lightCount":   len(creationMaps(scene["lights"])),
	}
}

func projectPrevisTransform(value any) map[string]any {
	transform, _ := value.(map[string]any)
	return map[string]any{
		"position": projectPrevisVec3(transform["position"]),
		"rotation": projectPrevisVec3(transform["rotation"]),
		"scale":    projectPrevisVec3(transform["scale"]),
	}
}

func projectPrevisVec3(value any) []any {
	items, ok := value.([]any)
	if !ok || len(items) != 3 {
		return []any{0, 0, 0}
	}
	result := make([]any, 3)
	for index, item := range items {
		result[index], _ = cloudAgentSafeNumber(item)
		if result[index] == nil {
			result[index] = 0
		}
	}
	return result
}

func numberValue(value any, fallback float64) float64 {
	if number, ok := cloudAgentSafeNumber(value); ok {
		switch typed := number.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		}
	}
	return fallback
}

func boolValue(value any, fallback bool) bool {
	if result, ok := value.(bool); ok {
		return result
	}
	return fallback
}
