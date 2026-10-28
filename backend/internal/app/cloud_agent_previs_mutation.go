package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	cloudAgentPrevisMaxOperations     = 32
	cloudAgentPrevisMaxScenes         = 32
	cloudAgentPrevisMaxShots          = 64
	cloudAgentPrevisMaxObjects        = 128
	cloudAgentPrevisMaxCameras        = 32
	cloudAgentPrevisMaxLights         = 64
	cloudAgentPrevisDocumentLimit     = 1 << 20
	cloudAgentPrevisTextLimit         = 160
	cloudAgentPrevisWorkstationWidth  = 520.0
	cloudAgentPrevisWorkstationHeight = 340.0
)

type cloudAgentPrevisSceneCreateArgs struct {
	CanvasSnapshotHash string `json:"canvasSnapshotHash"`
	SceneID            string `json:"sceneId"`
	Title              string `json:"title"`
	TemplateID         string `json:"templateId"`
	NodeID             string `json:"nodeId,omitempty"`
	NodeTitle          string `json:"nodeTitle,omitempty"`
}

type cloudAgentPrevisApplyPatchArgs struct {
	SnapshotHash string                           `json:"snapshotHash"`
	SceneID      string                           `json:"sceneId"`
	Operations   []cloudAgentPrevisPatchOperation `json:"operations"`
}

// cloudAgentPrevisPatchOperation is deliberately a closed semantic contract.
// It has no generic path, metadata, URL, storage key or raw scene field.
type cloudAgentPrevisPatchOperation struct {
	Type      string  `json:"type"`
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Title     *string `json:"title"`
	Kind      string  `json:"kind"`
	Primitive string  `json:"primitive"`
	Archetype string  `json:"archetype"` // adult/child/elderly/man/woman/monster
	Color     *string `json:"color"`
	ParentID  *string `json:"parentId"`
	Visible   *bool   `json:"visible"`
	Pose      string  `json:"pose"`
	Motion    string  `json:"motion"`

	CharacterAssetID   *string `json:"characterAssetId"`
	CharacterVersionID *string `json:"characterVersionId"`
	ReferenceNodeID    *string `json:"referenceNodeId"`
	CharacterName      *string `json:"characterName"`

	Position *[]float64 `json:"position"`
	Rotation *[]float64 `json:"rotation"`
	Scale    *[]float64 `json:"scale"`
	Target   *[]float64 `json:"target"`

	KeyframeID   *string     `json:"keyframeId"`
	Time         *float64    `json:"time"`
	Easing       string      `json:"easing"`
	PathPoints   [][]float64 `json:"pathPoints"`
	PathSpeed    string      `json:"pathSpeed"`
	StartDelay   *float64    `json:"startDelay"`
	OrientToPath *bool       `json:"orientToPath"`

	CameraID    *string  `json:"cameraId"`
	Duration    *float64 `json:"duration"`
	FPS         *int     `json:"fps"`
	ShotSize    string   `json:"shotSize"`
	CameraMove  string   `json:"cameraMove"`
	Prompt      *string  `json:"prompt"`
	FocalLength *float64 `json:"focalLength"`

	LightType  *string  `json:"lightType"`
	Intensity  *float64 `json:"intensity"`
	Angle      *float64 `json:"angle"`
	Penumbra   *float64 `json:"penumbra"`
	CastShadow *bool    `json:"castShadow"`

	Background           *string  `json:"background"`
	EnvironmentIntensity *float64 `json:"environmentIntensity"`
	GridVisible          *bool    `json:"gridVisible"`
	ActiveShotID         *string  `json:"activeShotId"`
}

type cloudAgentPrevisMutationPlan struct {
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	AfterSnapshotHash  string
	ResultSnapshotHash string
	Operation          string
	Preview            cloudAgentApprovalPreview
	SceneID            string
	NodeID             string
	ShotID             string
}

func cloudAgentPrevisSceneCreateSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"canvasSnapshotHash": map[string]any{"type": "string", "description": "canvasSnapshotHash returned by the previs_scene_read scene catalog; the canvas must be unchanged before creating"},
			"sceneId":            map[string]any{"type": "string", "maxLength": 80, "description": "New stable scene ID"},
			"title":              map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit, "description": "Scene title"},
			"templateId":         map[string]any{"type": "string", "enum": []string{"empty", "monologue", "dialogue", "blocking", "product", "action_chase", "interior", "crowd"}, "description": "Template: empty/monologue/dialogue/blocking/product/action_chase/interior/crowd"},
			"nodeId":             map[string]any{"type": "string", "maxLength": 80, "description": "Optional previs video workstation node ID; when omitted a stable ID is derived from sceneId"},
			"nodeTitle":          map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit, "description": "Optional previs video workstation node title"},
		},
		"required":             []string{"canvasSnapshotHash", "sceneId", "title", "templateId"},
		"additionalProperties": false,
	}
}

func cloudAgentPrevisPatchOperationSchema() map[string]any {
	vec3 := map[string]any{"type": "array", "minItems": 3, "maxItems": 3, "items": map[string]any{"type": "number"}}
	properties := map[string]any{
		"type":               map[string]any{"type": "string", "enum": []string{"scene_update", "shot_add", "shot_update", "shot_remove", "object_add", "object_update", "object_remove", "object_keyframe_upsert", "object_keyframe_remove", "object_motion_path_set", "object_motion_path_clear", "actor_motion_add", "actor_motion_remove", "camera_add", "camera_update", "camera_remove", "camera_keyframe_upsert", "camera_keyframe_remove", "light_add", "light_update", "light_remove"}},
		"id":                 map[string]any{"type": "string", "maxLength": 80, "description": "Target or new resource ID"},
		"name":               map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"title":              map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"kind":               map[string]any{"type": "string", "enum": []string{"primitive", "actor"}},
		"primitive":          map[string]any{"type": "string", "enum": []string{"box", "sphere", "cylinder", "plane", "character"}},
		"archetype":          map[string]any{"type": "string", "enum": []string{"adult", "child", "elderly", "man", "woman", "monster"}, "description": "Actor body archetype"},
		"characterAssetId":   map[string]any{"type": "string", "maxLength": 120},
		"characterVersionId": map[string]any{"type": "string", "maxLength": 120},
		"referenceNodeId":    map[string]any{"type": "string", "maxLength": 120},
		"characterName":      map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"pose":               map[string]any{"type": "string", "enum": []string{"stand", "sit", "walk", "run", "wave", "think", "fight", "kick", "throw", "push", "reach", "arms_crossed", "phone", "bow", "kneel_single", "kneel_double", "lean", "squat", "hands_hips", "neutral", "t_pose"}, "description": "Actor pose"},
		"color":              map[string]any{"type": "string", "maxLength": 9, "pattern": `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`, "description": "Hex color"},
		"parentId":           map[string]any{"type": "string", "maxLength": 80},
		"visible":            map[string]any{"type": "boolean"},
		"motion":             map[string]any{"type": "string", "enum": cloudAgentPrevisMotionIDs, "description": "actor_motion_add motion; time=start seconds, duration=length, intensity=amplitude 0.2-2; for remove pass the motion id in keyframeId"},

		"position":             vec3,
		"rotation":             vec3,
		"scale":                vec3,
		"target":               vec3,
		"keyframeId":           map[string]any{"type": "string", "maxLength": 120},
		"time":                 map[string]any{"type": "number", "minimum": 0, "maximum": 60},
		"easing":               map[string]any{"type": "string", "enum": []string{"step", "linear", "smooth"}},
		"pathPoints":           map[string]any{"type": "array", "minItems": 2, "maxItems": 64, "items": vec3},
		"pathSpeed":            map[string]any{"type": "string", "enum": []string{"slow", "walk", "run"}},
		"startDelay":           map[string]any{"type": "number", "minimum": 0, "maximum": 60},
		"orientToPath":         map[string]any{"type": "boolean"},
		"cameraId":             map[string]any{"type": "string", "maxLength": 80},
		"duration":             map[string]any{"type": "number", "minimum": 0.1, "maximum": 60},
		"fps":                  map[string]any{"type": "integer", "minimum": 1, "maximum": 60},
		"shotSize":             map[string]any{"type": "string", "enum": []string{"extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"}},
		"cameraMove":           map[string]any{"type": "string", "enum": []string{"static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"}},
		"prompt":               map[string]any{"type": "string", "maxLength": 2000},
		"focalLength":          map[string]any{"type": "number", "minimum": 1, "maximum": 300},
		"lightType":            map[string]any{"type": "string", "enum": []string{"directional", "point", "spot", "ambient"}},
		"intensity":            map[string]any{"type": "number", "minimum": 0, "maximum": 100},
		"angle":                map[string]any{"type": "number", "minimum": 0, "maximum": 6.29},
		"penumbra":             map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"castShadow":           map[string]any{"type": "boolean"},
		"background":           map[string]any{"type": "string", "maxLength": 32},
		"environmentIntensity": map[string]any{"type": "number", "minimum": 0, "maximum": 100},
		"gridVisible":          map[string]any{"type": "boolean"},
		"activeShotId":         map[string]any{"type": "string", "maxLength": 80},
	}
	return map[string]any{"type": "object", "properties": properties, "required": []string{"type", "id"}, "additionalProperties": false}
}

func cloudAgentPrevisApplyPatchSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"snapshotHash": map[string]any{"type": "string", "description": "Scene snapshotHash returned by a focused previs_scene_read; covers only that scene"},
			"sceneId":      map[string]any{"type": "string", "maxLength": 80, "description": "ID of the scene to change"},
			"operations":   map[string]any{"type": "array", "minItems": 1, "maxItems": cloudAgentPrevisMaxOperations, "items": cloudAgentPrevisPatchOperationSchema(), "description": "Restricted semantic operations; cannot replace the whole scene or write arbitrary JSON"},
		},
		"required":             []string{"snapshotHash", "sceneId", "operations"},
		"additionalProperties": false,
	}
}

func cloudAgentPrevisValidateText(value, label string, maxRunes int, required bool) error {
	if required && strings.TrimSpace(value) == "" {
		return BadAuthRequest(label + " must not be empty")
	}
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return BadAuthRequest(label + " must not have leading/trailing whitespace or invalid characters")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return fmt.Errorf("%s must not exceed %d characters", label, maxRunes)
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return BadAuthRequest(label + " must not contain control characters")
		}
	}
	return nil
}

// cloudAgentPrevisValidatePose validates pose against the canonical enum.
func cloudAgentPrevisValidatePose(pose string) error {
	valid := map[string]bool{
		"stand": true, "sit": true, "walk": true, "run": true, "wave": true, "think": true,
		"fight": true, "kick": true, "throw": true, "push": true, "reach": true, "arms_crossed": true,
		"phone": true, "bow": true, "kneel_single": true, "kneel_double": true, "lean": true,
		"squat": true, "hands_hips": true, "neutral": true, "t_pose": true,
	}
	if !valid[pose] {
		return BadAuthRequest(fmt.Sprintf("pose value %q is not supported; use stand/sit/walk/run/wave/think/fight and so on", pose))
	}
	return nil
}

func cloudAgentPrevisValidateEnum(value, label string, allowed ...string) error {
	for _, candidate := range allowed {
		if value == candidate {
			return nil
		}
	}
	return BadAuthRequest(label + " is not supported")
}

func cloudAgentPrevisIsHexColor(value string) bool {
	if len(value) != 4 && len(value) != 7 && len(value) != 9 || value[0] != '#' {
		return false
	}
	for _, r := range value[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}

func cloudAgentPrevisNormalizeLegacyColor(value string) string {
	trimmed := strings.TrimSpace(value)
	if cloudAgentPrevisIsHexColor(trimmed) {
		return strings.ToLower(trimmed)
	}
	lower := strings.ToLower(trimmed)
	var raw string
	var rgba bool
	switch {
	case strings.HasPrefix(lower, "rgb(") && strings.HasSuffix(lower, ")"):
		raw = trimmed[4 : len(trimmed)-1]
	case strings.HasPrefix(lower, "rgba(") && strings.HasSuffix(lower, ")"):
		raw = trimmed[5 : len(trimmed)-1]
		rgba = true
	default:
		return value
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 3 && len(parts) != 4 {
		return value
	}
	channels := make([]int, 3)
	for index := range channels {
		channel, err := strconv.Atoi(strings.TrimSpace(parts[index]))
		if err != nil || channel < 0 || channel > 255 {
			return value
		}
		channels[index] = channel
	}
	if !rgba && len(parts) == 4 {
		return value
	}
	result := fmt.Sprintf("#%02x%02x%02x", channels[0], channels[1], channels[2])
	if rgba && len(parts) == 4 {
		alpha, err := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64)
		if err != nil {
			return value
		}
		if alpha <= 1 {
			alpha = math.Round(alpha * 255)
		}
		if alpha < 0 || alpha > 255 {
			return value
		}
		result += fmt.Sprintf("%02x", int(alpha))
	}
	return result
}

// Legacy scenes can contain CSS rgb/rgba colors from the browser-era editor.
// Normalize those values before strict validation so a harmless scene read or
// patch is not blocked by historical presentation data.
func cloudAgentPrevisNormalizeSceneColor(value, fallback string) string {
	normalized := cloudAgentPrevisNormalizeLegacyColor(value)
	if cloudAgentPrevisIsHexColor(normalized) {
		return normalized
	}
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func cloudAgentPrevisValidateColor(value, label string) error {
	if err := cloudAgentPrevisValidateText(value, label, 32, true); err != nil {
		return err
	}
	if !cloudAgentPrevisIsHexColor(value) {
		return BadAuthRequest(label + " must be a hex color")
	}
	return nil
}

func cloudAgentPrevisFiniteInRange(value float64, label string, minimum, maximum float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < minimum || value > maximum {
		return BadAuthRequest(label + " is out of range")
	}
	return nil
}

func cloudAgentPrevisValidateTemplateID(value string) error {
	valid := map[string]bool{"empty": true, "monologue": true, "dialogue": true, "blocking": true, "product": true, "action_chase": true, "interior": true, "crowd": true}
	if !valid[value] {
		return BadAuthRequest("templateId is not supported; valid values: empty/monologue/dialogue/blocking/product/action_chase/interior/crowd")
	}
	return nil
}

func cloudAgentPrevisValidateVec3(value []float64, label string) error {
	if len(value) != 3 {
		return BadAuthRequest(label + " must be an array of 3 numbers")
	}
	for _, number := range value {
		if math.IsNaN(number) || math.IsInf(number, 0) || math.Abs(number) > 100000 {
			return BadAuthRequest(label + " contains invalid or out-of-range numbers")
		}
	}
	return nil
}

func cloudAgentPrevisVec3(value []float64) []any {
	return []any{value[0], value[1], value[2]}
}

func cloudAgentPrevisNumberVec3(value any) ([]float64, bool) {
	result := make([]float64, 3)
	switch items := value.(type) {
	case []float64:
		if len(items) != 3 {
			return nil, false
		}
		copy(result, items)
	case []any:
		if len(items) != 3 {
			return nil, false
		}
		for index, item := range items {
			result[index] = numberValue(item, math.NaN())
		}
	default:
		return nil, false
	}
	for _, number := range result {
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, false
		}
	}
	return result, true
}

func cloudAgentPrevisOptionalVec3(value *[]float64, label string) error {
	if value == nil {
		return nil
	}
	return cloudAgentPrevisValidateVec3(*value, label)
}

func cloudAgentPrevisTextPointer(value *string, label string, maxRunes int) error {
	if value == nil {
		return nil
	}
	return cloudAgentPrevisValidateText(*value, label, maxRunes, false)
}

func cloudAgentPrevisCanvas(repo *repository.Repository, userID, canvasID string) (*model.CanvasProject, map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, err
	}
	return canvas, doc, nil
}

func cloudAgentPrevisScenesSize(scenes []map[string]any) error {
	encoded, err := json.Marshal(scenes)
	if err != nil || len(encoded) > cloudAgentPrevisDocumentLimit {
		return BadAuthRequest("Previs scene data exceeds the limit")
	}
	return nil
}

func cloudAgentPrevisIDSet(items []map[string]any, label string) (map[string]map[string]any, error) {
	result := make(map[string]map[string]any, len(items))
	for _, item := range items {
		id := stringValue(item["id"])
		if err := validateCloudAgentID(id, label, 80); err != nil {
			return nil, err
		}
		if _, exists := result[id]; exists {
			return nil, BadAuthRequest(label + " is duplicated")
		}
		result[id] = item
	}
	return result, nil
}

func cloudAgentPrevisFinite(value any) bool {
	number := numberValue(value, math.NaN())
	return !math.IsNaN(number) && !math.IsInf(number, 0)
}

func cloudAgentPrevisValidateTransform(value any, label string) error {
	transform, ok := value.(map[string]any)
	if !ok {
		return BadAuthRequest(label + " is missing transform")
	}
	for _, key := range []string{"position", "rotation", "scale"} {
		items, ok := transform[key].([]any)
		if !ok || len(items) != 3 {
			return BadAuthRequest(label + " transform." + key + " must contain 3 numbers")
		}
		for _, item := range items {
			if !cloudAgentPrevisFinite(item) {
				return BadAuthRequest(label + " transform contains invalid numbers")
			}
		}
	}
	return nil
}

func cloudAgentPrevisValidateScene(scene map[string]any) error {
	if err := validateCloudAgentID(stringValue(scene["id"]), "Previs scene ID", 80); err != nil {
		return err
	}
	if numberValue(scene["version"], 0) != 1 {
		return BadAuthRequest("Previs scene version is not supported")
	}
	if err := cloudAgentPrevisValidateText(stringValue(scene["title"]), "Scene title", cloudAgentPrevisTextLimit, true); err != nil {
		return err
	}
	background := cloudAgentPrevisNormalizeSceneColor(stringValue(scene["background"]), "#111827")
	scene["background"] = background
	if err := cloudAgentPrevisValidateColor(stringValue(scene["background"]), "Scene background color"); err != nil {
		return err
	}
	if err := cloudAgentPrevisFiniteInRange(numberValue(scene["environmentIntensity"], math.NaN()), "Ambient light intensity", 0, 100); err != nil {
		return err
	}
	objects := creationMaps(scene["objects"])
	cameras := creationMaps(scene["cameras"])
	lights := creationMaps(scene["lights"])
	shots := creationMaps(scene["shots"])
	if len(objects) > cloudAgentPrevisMaxObjects || len(cameras) > cloudAgentPrevisMaxCameras || len(lights) > cloudAgentPrevisMaxLights || len(shots) > cloudAgentPrevisMaxShots {
		return BadAuthRequest("Previs scene has too many objects, cameras, lights or shots")
	}
	objectByID, err := cloudAgentPrevisIDSet(objects, "Previs object ID")
	if err != nil {
		return err
	}
	cameraByID, err := cloudAgentPrevisIDSet(cameras, "Previs camera ID")
	if err != nil {
		return err
	}
	_, err = cloudAgentPrevisIDSet(lights, "Previs light ID")
	if err != nil {
		return err
	}
	shotByID, err := cloudAgentPrevisIDSet(shots, "Previs shot ID")
	if err != nil {
		return err
	}
	if len(shots) == 0 || stringValue(scene["activeShotId"]) == "" || shotByID[stringValue(scene["activeShotId"])] == nil {
		return BadAuthRequest("Previs scene must have a valid activeShotId")
	}
	for id, object := range objectByID {
		if err := cloudAgentPrevisValidateText(stringValue(object["name"]), "Previs object name", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(object["kind"]), "Previs object kind", "primitive", "model", "actor", "billboard"); err != nil {
			return err
		}
		if primitive := stringValue(object["primitive"]); primitive != "" {
			if err := cloudAgentPrevisValidateEnum(primitive, "Previs object primitive", "box", "sphere", "cylinder", "plane", "character"); err != nil {
				return err
			}
		}
		objectColor := cloudAgentPrevisNormalizeSceneColor(stringValue(object["color"]), "#8795a5")
		object["color"] = objectColor
		if err := cloudAgentPrevisValidateColor(stringValue(object["color"]), "Previs object color"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateTransform(object["transform"], "Previs object "+id); err != nil {
			return err
		}
		if binding, ok := object["characterBinding"].(map[string]any); ok {
			for _, key := range []string{"characterAssetId", "characterVersionId", "referenceNodeId"} {
				if err := validateCloudAgentID(stringValue(binding[key]), "Character binding "+key, 120); err != nil {
					return err
				}
			}
			if name := stringValue(binding["characterName"]); name != "" {
				if err := cloudAgentPrevisValidateText(name, "Character binding characterName", cloudAgentPrevisTextLimit, true); err != nil {
					return err
				}
			}
		}
		if keyframes, ok := object["keyframes"]; ok {
			for _, keyframe := range creationMaps(keyframes) {
				if err := validateCloudAgentID(stringValue(keyframe["id"]), "Object keyframe ID", 120); err != nil {
					return err
				}
				if err := cloudAgentPrevisFiniteInRange(numberValue(keyframe["time"], math.NaN()), "Object keyframe time", 0, 60); err != nil {
					return err
				}
				if err := cloudAgentPrevisValidateTransform(keyframe["transform"], "Object keyframe "+stringValue(keyframe["id"])); err != nil {
					return err
				}
			}
		}
		if motionPath, ok := object["motionPath"].(map[string]any); ok {
			points, pointsOK := motionPath["points"].([]any)
			if !pointsOK || len(points) < 2 || len(points) > 64 {
				return BadAuthRequest("Previs motionPath has an invalid number of points")
			}
			for index, point := range points {
				value, ok := cloudAgentPrevisNumberVec3(point)
				if !ok {
					return BadAuthRequest(fmt.Sprintf("Previs motionPath point %d is invalid", index))
				}
				if err := cloudAgentPrevisValidateVec3(value, "motionPath point"); err != nil {
					return err
				}
			}
			if err := cloudAgentPrevisValidateEnum(stringValue(motionPath["speed"]), "motionPath speed", "slow", "walk", "run"); err != nil {
				return err
			}
			if err := cloudAgentPrevisFiniteInRange(numberValue(motionPath["startDelay"], math.NaN()), "motionPath startDelay", 0, 60); err != nil {
				return err
			}
		}
		if parentID := stringValue(object["parentId"]); parentID != "" {
			if err := validateCloudAgentID(parentID, "Previs object parentId", 80); err != nil {
				return err
			}
			if objectByID[parentID] == nil || parentID == id {
				return BadAuthRequest("Previs object parentId is invalid")
			}
		}
	}
	for id, camera := range cameraByID {
		if err := cloudAgentPrevisValidateText(stringValue(camera["name"]), "Previs camera name", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(camera["focalLength"], math.NaN()), "Camera focal length", 1, 300); err != nil {
			return err
		}
		target, targetOK := cloudAgentPrevisNumberVec3(camera["target"])
		if !targetOK {
			return BadAuthRequest("Previs camera " + id + " target must contain 3 numbers")
		}
		if err := cloudAgentPrevisValidateVec3(target, "Previs camera "+id+" target"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateTransform(camera["transform"], "Previs camera "+id); err != nil {
			return err
		}
		if keyframes, ok := camera["keyframes"]; ok {
			for _, keyframe := range creationMaps(keyframes) {
				if err := validateCloudAgentID(stringValue(keyframe["id"]), "Camera keyframe ID", 120); err != nil {
					return err
				}
				if err := cloudAgentPrevisFiniteInRange(numberValue(keyframe["time"], math.NaN()), "Camera keyframe time", 0, 60); err != nil {
					return err
				}
				if err := cloudAgentPrevisValidateTransform(keyframe["transform"], "Camera keyframe "+stringValue(keyframe["id"])); err != nil {
					return err
				}
			}
		}
	}
	for id, shot := range shotByID {
		cameraID := stringValue(shot["cameraId"])
		if cameraByID[cameraID] == nil {
			return BadAuthRequest("Previs shot " + id + " references a camera that does not exist")
		}
		duration := numberValue(shot["duration"], math.NaN())
		fps := numberValue(shot["fps"], math.NaN())
		if err := cloudAgentPrevisFiniteInRange(duration, "Previs shot duration", 0.1, 60); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(fps, "Previs shot frame rate", 1, 60); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateText(stringValue(shot["name"]), "Previs shot name", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(shot["shotSize"]), "Previs shot size", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(shot["cameraMove"]), "Previs camera move", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateText(stringValue(shot["prompt"]), "Previs shot prompt", 2000, false); err != nil {
			return err
		}
	}
	for _, light := range creationMaps(scene["lights"]) {
		lightID := stringValue(light["id"])
		if err := cloudAgentPrevisValidateText(stringValue(light["name"]), "Previs light name", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(light["type"]), "Previs light type", "directional", "point", "spot", "ambient"); err != nil {
			return err
		}
		lightColor := cloudAgentPrevisNormalizeSceneColor(stringValue(light["color"]), "#ffffff")
		light["color"] = lightColor
		if err := cloudAgentPrevisValidateColor(stringValue(light["color"]), "Previs light color"); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(light["intensity"], math.NaN()), "Previs light intensity", 0, 100); err != nil {
			return err
		}
		if angle, ok := light["angle"]; ok {
			if err := cloudAgentPrevisFiniteInRange(numberValue(angle, math.NaN()), "Previs light "+lightID+" angle", 0, 6.29); err != nil {
				return err
			}
		}
		if penumbra, ok := light["penumbra"]; ok {
			if err := cloudAgentPrevisFiniteInRange(numberValue(penumbra, math.NaN()), "Previs light "+lightID+" penumbra", 0, 1); err != nil {
				return err
			}
		}
		if err := cloudAgentPrevisValidateTransform(light["transform"], "Previs light "+lightID); err != nil {
			return err
		}
	}
	// Parent links are a small directed graph. Walk every chain to reject cycles.
	for id := range objectByID {
		seen := map[string]bool{}
		for current := id; current != ""; {
			if seen[current] {
				return BadAuthRequest("Previs object parentId must not form a cycle")
			}
			seen[current] = true
			current = stringValue(objectByID[current]["parentId"])
			if current != "" && objectByID[current] == nil {
				return BadAuthRequest("Previs object parentId references an object that does not exist")
			}
		}
	}
	return nil
}

func cloudAgentPrevisSceneCreateTemplate(args cloudAgentPrevisSceneCreateArgs) (map[string]any, error) {
	if err := validateCloudAgentID(args.SceneID, "Previs scene ID", 80); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisValidateText(args.Title, "Scene title", cloudAgentPrevisTextLimit, true); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisValidateTemplateID(args.TemplateID); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cameraID := args.SceneID + "-camera-1"
	shotID := args.SceneID + "-shot-1"
	camera := map[string]any{
		"id": cameraID, "name": "Main camera",
		"transform": map[string]any{"position": []any{4.8, 2.7, 6.8}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}},
		"target":    []any{0, 1, 0}, "focalLength": 35, "fov": 50, "aperture": 2.8, "focusDistance": 5, "near": 0.05, "far": 500, "keyframes": []any{},
	}
	objects := []any{}
	lights := []any{
		map[string]any{"id": args.SceneID + "-light-key", "name": "Key light", "type": "directional", "transform": map[string]any{"position": []any{4, 6, 4}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 2.4, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": true},
		map[string]any{"id": args.SceneID + "-light-fill", "name": "Rim light", "type": "directional", "transform": map[string]any{"position": []any{-4, 3, -2}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 1.1, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": true},
		map[string]any{"id": args.SceneID + "-light-ambient", "name": "Ambient light", "type": "ambient", "transform": map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 0.65, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": false},
	}
	if args.TemplateID == "action_chase" {
		// Two actors: pursuer behind, target ahead, side-angle camera for kinetic energy
		objects = append(objects,
			map[string]any{"id": args.SceneID + "-actor-1", "name": "Chaser", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, -1.2}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "run", "archetype": "man", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
			map[string]any{"id": args.SceneID + "-actor-2", "name": "Runner", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, 2.0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#d84949", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "run", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
		)
		camera["transform"] = map[string]any{"position": []any{3.8, 1.4, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{0, 1, 0.5}
		camera["focalLength"] = 50
		camera["fov"] = 39.6
	}
	if args.TemplateID == "interior" {
		// Room sketch: floor plane, 3 wall planes, sofa-scale box, table-scale box
		objects = append(objects,
			map[string]any{"id": args.SceneID + "-wall-back", "name": "Back wall", "kind": "primitive", "primitive": "plane", "transform": map[string]any{"position": []any{0, 2.0, -3.0}, "rotation": []any{0, 0, 0}, "scale": []any{6, 4, 1}}, "color": "#d8dde3", "visible": true, "castShadow": false, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-wall-left", "name": "Left wall", "kind": "primitive", "primitive": "plane", "transform": map[string]any{"position": []any{-3.0, 2.0, 0}, "rotation": []any{0, 1.5708, 0}, "scale": []any{6, 4, 1}}, "color": "#d8dde3", "visible": true, "castShadow": false, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-sofa", "name": "Sofa", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.45, -1.8}, "rotation": []any{0, 0, 0}, "scale": []any{2.2, 0.9, 0.9}}, "color": "#8795a5", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-table", "name": "Coffee table", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.23, 0.2}, "rotation": []any{0, 0, 0}, "scale": []any{1.1, 0.46, 0.65}}, "color": "#6b7580", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-actor-1", "name": "Actor 1", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{-0.6, 0, 0.6}, "rotation": []any{0, -0.4, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "sit", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
		)
		camera["transform"] = map[string]any{"position": []any{3.2, 1.65, 3.0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{-0.2, 1.0, 0}
		camera["focalLength"] = 35
	}
	if args.TemplateID == "crowd" {
		// 3x3 crowd grid with distinct colors
		crowdColors := []string{"#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#e879f9", "#2f7de1", "#d84949", "#dfae3f"}
		for row := 0; row < 3; row++ {
			for col := 0; col < 3; col++ {
				idx := row*3 + col
				id := fmt.Sprintf("%s-actor-%d", args.SceneID, idx+1)
				x := float64(col-1) * 1.2
				z := float64(row-1) * 1.2
				objects = append(objects, map[string]any{
					"id": id, "name": fmt.Sprintf("Extra %d", idx+1), "kind": "actor", "primitive": "character",
					"transform": map[string]any{"position": []any{x, 0, z}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}},
					"color":     crowdColors[idx], "visible": true, "castShadow": true, "receiveShadow": true,
					"pose": "stand", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{},
				})
			}
		}
		camera["transform"] = map[string]any{"position": []any{0.5, 4.5, 6.5}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{0, 0.8, 0}
		camera["focalLength"] = 28
		camera["fov"] = 65.0
	}
	if args.TemplateID == "monologue" || args.TemplateID == "dialogue" || args.TemplateID == "blocking" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-actor-1", "name": "Actor 1", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#f1f3f5", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "stand", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}})
	}
	if args.TemplateID == "dialogue" || args.TemplateID == "blocking" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-actor-2", "name": "Actor 2", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{1.8, 0, -0.8}, "rotation": []any{0, 0.2, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "stand", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}})
	}
	if args.TemplateID == "product" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-product-1", "name": "Product", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.6, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1.2, 1.2, 1.2}}, "color": "#8795a5", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}})
	}
	scene := map[string]any{
		"id": args.SceneID, "version": 1, "title": args.Title, "background": "#d8dde3", "environmentIntensity": 0.7, "gridVisible": true,
		"objects": objects, "cameras": []any{camera}, "lights": lights,
		"shots":        []any{map[string]any{"id": shotID, "name": "Shot 1", "cameraId": cameraID, "duration": 5, "fps": 24, "shotSize": "medium", "cameraMove": "static", "prompt": "", "cuts": []any{}}},
		"activeShotId": shotID, "createdAt": now, "updatedAt": now,
	}
	return scene, cloudAgentPrevisValidateScene(scene)
}

func cloudAgentPrevisWorkstationNodeID(sceneID string) string {
	candidate := "previs-" + sceneID
	if utf8.RuneCountInString(candidate) <= 80 {
		return candidate
	}
	return "previs-" + creationHash(map[string]any{"sceneId": sceneID})[:40]
}

func cloudAgentPrevisActiveShot(scene map[string]any) (string, string, int, error) {
	activeShotID := stringValue(scene["activeShotId"])
	for index, shot := range creationMaps(scene["shots"]) {
		if activeShotID != "" && stringValue(shot["id"]) != activeShotID {
			continue
		}
		shotID := stringValue(shot["id"])
		if shotID == "" {
			return "", "", 0, BadAuthRequest("The previs scene's active shot has no stable ID")
		}
		shotTitle := stringValue(shot["name"])
		if shotTitle == "" {
			shotTitle = fmt.Sprintf("Shot %d", index+1)
		}
		return shotID, shotTitle, index + 1, nil
	}
	return "", "", 0, BadAuthRequest("The previs scene has no active shot to bind")
}

func cloudAgentPrevisWorkstationPosition(nodes []map[string]any) (float64, float64) {
	right := math.Inf(-1)
	y := 80.0
	for _, node := range nodes {
		position, _ := node["position"].(map[string]any)
		x := numberValue(position["x"], 0)
		width := numberValue(node["width"], 340)
		if x+width > right {
			right = x + width
			y = math.Max(80, numberValue(position["y"], 80))
		}
	}
	if math.IsInf(right, -1) {
		return 80, 80
	}
	return math.Max(80, right+80), y
}

func cloudAgentPrevisEnsureWorkstationNode(doc map[string]any, scene map[string]any, requestedNodeID, requestedTitle string) (string, string, bool, error) {
	sceneID := stringValue(scene["id"])
	if err := validateCloudAgentID(sceneID, "Previs scene ID", 80); err != nil {
		return "", "", false, err
	}
	shotID, shotTitle, shotIndex, err := cloudAgentPrevisActiveShot(scene)
	if err != nil {
		return "", "", false, err
	}

	nodeID := strings.TrimSpace(requestedNodeID)
	if nodeID != "" {
		if err := validateCloudAgentID(nodeID, "Previs workstation node ID", 80); err != nil {
			return "", "", false, err
		}
	} else {
		nodeID = cloudAgentPrevisWorkstationNodeID(sceneID)
	}
	title := strings.TrimSpace(requestedTitle)
	if title == "" {
		title = stringValue(scene["title"])
	}
	if title == "" {
		title = shotTitle
	}
	if err := cloudAgentPrevisValidateText(title, "Previs workstation title", cloudAgentPrevisTextLimit, true); err != nil {
		return "", "", false, err
	}

	nodes := creationMaps(doc["nodes"])
	var bound map[string]any
	for _, node := range nodes {
		metadata, _ := node["metadata"].(map[string]any)
		if stringValue(metadata["previsSceneId"]) != sceneID {
			continue
		}
		if stringValue(node["type"]) != "video" {
			return "", "", false, BadAuthRequest("The previs scene is bound to a non-video node; the workstation cannot be repaired")
		}
		if bound != nil && stringValue(bound["id"]) != stringValue(node["id"]) {
			return "", "", false, BadAuthRequest("The previs scene is bound to several workstation nodes; one cannot be chosen automatically")
		}
		bound = node
	}

	var requested map[string]any
	for _, node := range nodes {
		if stringValue(node["id"]) == nodeID {
			requested = node
			break
		}
	}
	if requested != nil {
		if stringValue(requested["type"]) != "video" {
			return "", "", false, BadAuthRequest("The previs workstation node ID is already used by a non-video node")
		}
		metadata, _ := requested["metadata"].(map[string]any)
		otherSceneID := stringValue(metadata["previsSceneId"])
		if otherSceneID != "" && otherSceneID != sceneID {
			return "", "", false, BadAuthRequest("The previs workstation node ID is already bound to another scene")
		}
		if bound != nil && stringValue(bound["id"]) != nodeID {
			return "", "", false, BadAuthRequest("The previs scene is already bound to another workstation node")
		}
		bound = requested
	}

	created := false
	if bound == nil {
		positionX, positionY := cloudAgentPrevisWorkstationPosition(nodes)
		metadata := map[string]any{
			"content":            "",
			"status":             "idle",
			"workflowKind":       "shot",
			"workflowTitle":      shotTitle,
			"shotIndex":          float64(shotIndex),
			"generationMode":     "video",
			"videoEditOperation": "text_to_video",
			"composerContent":    "",
			"previsSceneId":      sceneID,
			"previsShotId":       shotID,
		}
		width, height := cloudAgentPrevisWorkstationWidth, cloudAgentPrevisWorkstationHeight
		op := CreationCanvasOp{Type: "add_node", ID: nodeID, NodeType: "video", Title: title, X: &positionX, Y: &positionY, Width: &width, Height: &height, Metadata: metadata}
		nodes = append(nodes, creationAddedNode(op))
		doc["nodes"] = nodes
		return nodeID, shotID, true, nil
	}

	metadata, _ := bound["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["workflowKind"] = "shot"
	metadata["workflowTitle"] = shotTitle
	metadata["shotIndex"] = float64(shotIndex)
	metadata["generationMode"] = "video"
	metadata["videoEditOperation"] = "text_to_video"
	metadata["previsSceneId"] = sceneID
	metadata["previsShotId"] = shotID
	if _, exists := metadata["status"]; !exists {
		metadata["status"] = "idle"
	}
	if _, exists := metadata["composerContent"]; !exists {
		metadata["composerContent"] = ""
	}
	bound["metadata"] = metadata
	if stringValue(bound["title"]) == "" || strings.TrimSpace(requestedTitle) != "" {
		bound["title"] = title
	}
	doc["nodes"] = nodes
	return stringValue(bound["id"]), shotID, created, nil
}

func prepareCloudAgentPrevisSceneCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentPrevisMutationPlan, error) {
	var args cloudAgentPrevisSceneCreateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.CanvasSnapshotHash) == "" {
		return nil, cloudAgentFieldError("canvasSnapshotHash", "required", "Read the scene catalog before creating a previs scene")
	}
	if err := validateCloudAgentID(args.SceneID, "Previs scene ID", 80); err != nil {
		return nil, cloudAgentFieldError("sceneId", "invalid_value", cloudAgentSafeToolError(err))
	}
	if args.NodeID != "" {
		if err := validateCloudAgentID(args.NodeID, "Previs workstation node ID", 80); err != nil {
			return nil, cloudAgentFieldError("nodeId", "invalid_value", cloudAgentSafeToolError(err))
		}
	}
	if args.NodeTitle != "" {
		if err := cloudAgentPrevisValidateText(args.NodeTitle, "Previs workstation title", cloudAgentPrevisTextLimit, false); err != nil {
			return nil, cloudAgentFieldError("nodeTitle", "invalid_value", cloudAgentSafeToolError(err))
		}
	}
	canvas, doc, err := cloudAgentPrevisCanvas(repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.CanvasSnapshotHash {
		return nil, &cloudAgentFieldArgumentError{error: &cloudAgentArgumentError{creationConflict("The canvas changed, so the scene was not created; read the scene catalog again")}, Field: "canvasSnapshotHash", Issue: "stale_snapshot"}
	}
	scenes := creationMaps(doc["previsScenes"])
	if len(scenes) >= cloudAgentPrevisMaxScenes {
		return nil, BadAuthRequest("This canvas has reached its previs scene limit")
	}
	if _, exists := findPrevisScene(scenes, args.SceneID); exists {
		return nil, BadAuthRequest("Previs scene ID already exists")
	}
	scene, err := cloudAgentPrevisSceneCreateTemplate(args)
	if err != nil {
		return nil, err
	}
	scenes = append(scenes, scene)
	if err := cloudAgentPrevisScenesSize(scenes); err != nil {
		return nil, err
	}
	doc["previsScenes"] = scenes
	nodeID, shotID, _, err := cloudAgentPrevisEnsureWorkstationNode(doc, scene, args.NodeID, args.NodeTitle)
	if err != nil {
		return nil, err
	}
	details := []string{"Create a controlled blockout scene", "Template: " + args.TemplateID, "Bind previs video workstation: " + nodeID}
	return &cloudAgentPrevisMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), ResultSnapshotHash: creationHash(scene), Operation: "previs_scene_create", SceneID: args.SceneID, NodeID: nodeID, ShotID: shotID, Preview: cloudAgentPrevisMutationApprovalPreview("previs_scene_create", args.SceneID, args.Title, details)}, nil
}

func prepareCloudAgentPrevisApplyPatch(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentPrevisMutationPlan, error) {
	var args cloudAgentPrevisApplyPatchArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.SnapshotHash) == "" {
		return nil, cloudAgentFieldError("snapshotHash", "required", "Read the target scene before applying a previs patch")
	}
	if len(args.Operations) < 1 || len(args.Operations) > cloudAgentPrevisMaxOperations {
		return nil, cloudAgentFieldError("operations", "item_count", fmt.Sprintf("Previs patch operations must contain 1 to %d operations", cloudAgentPrevisMaxOperations))
	}
	if err := validateCloudAgentID(args.SceneID, "Previs scene ID", 80); err != nil {
		return nil, err
	}
	canvas, doc, err := cloudAgentPrevisCanvas(repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	scenes := creationMaps(doc["previsScenes"])
	scene, ok := findPrevisScene(scenes, args.SceneID)
	if !ok {
		return nil, BadAuthRequest("The previs scene does not exist or does not belong to this canvas")
	}
	canvasSnapshotHash := cloudAgentCanvasHash(doc)
	sceneSnapshotHash := creationHash(scene)
	if sceneSnapshotHash != args.SnapshotHash {
		return nil, &cloudAgentFieldArgumentError{error: &cloudAgentArgumentError{creationConflict("The previs scene changed, so nothing was written; read it again and request approval again")}, Field: "snapshotHash", Issue: "stale_snapshot"}
	}
	items := make([]cloudAgentApprovalPreviewItem, 0, len(args.Operations))
	for index, operation := range args.Operations {
		if err := cloudAgentPrevisValidateCharacterBindingInCanvas(doc, operation); err != nil {
			return nil, err
		}
		item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, index)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	cloudAgentPrevisGroundScene(scene)
	scene["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisScenesSize(scenes); err != nil {
		return nil, err
	}
	doc["previsScenes"] = scenes
	nodeID, shotID, workstationCreated, err := cloudAgentPrevisEnsureWorkstationNode(doc, scene, "", "")
	if err != nil {
		return nil, err
	}
	details := itemsToDetails(items)
	if workstationCreated {
		details = append(details, "Create and bind previs video workstation: "+nodeID)
	}
	return &cloudAgentPrevisMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: canvasSnapshotHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), ResultSnapshotHash: creationHash(scene), Operation: "previs_apply_patch", SceneID: args.SceneID, NodeID: nodeID, ShotID: shotID, Preview: cloudAgentPrevisMutationApprovalPreview("previs_apply_patch", args.SceneID, stringValue(scene["title"]), details)}, nil
}

func itemsToDetails(items []cloudAgentApprovalPreviewItem) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item.Summary != "" {
			result = append(result, item.Summary)
		}
	}
	return result
}

func cloudAgentPrevisMutationApprovalPreview(operation, sceneID, title string, details []string) cloudAgentApprovalPreview {
	if len(details) > 12 {
		details = details[:12]
	}
	return cloudAgentApprovalPreview{Kind: "previs_mutation", Title: "Confirm previs changes", Description: fmt.Sprintf("The Agent is about to change previs scene '%s'. Nothing is written to the canvas until you approve.", truncateRunes(title, cloudAgentPrevisTextLimit)), Items: []cloudAgentApprovalPreviewItem{{Operation: operation, NodeID: sceneID, NodeTitle: truncateRunes(title, cloudAgentPrevisTextLimit), Details: details, Summary: fmt.Sprintf("Change previs scene '%s'", truncateRunes(title, cloudAgentPrevisTextLimit))}}}
}

func cloudAgentPrevisMapTransform(item map[string]any) map[string]any {
	if transform, ok := item["transform"].(map[string]any); ok {
		return transform
	}
	transform := map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
	item["transform"] = transform
	return transform
}

func cloudAgentPrevisApplyTransform(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if err := cloudAgentPrevisOptionalVec3(operation.Position, "position"); err != nil {
		return err
	}
	if err := cloudAgentPrevisOptionalVec3(operation.Rotation, "rotation"); err != nil {
		return err
	}
	if err := cloudAgentPrevisOptionalVec3(operation.Scale, "scale"); err != nil {
		return err
	}
	transform := cloudAgentPrevisMapTransform(item)
	if operation.Position != nil {
		transform["position"] = cloudAgentPrevisVec3(*operation.Position)
	}
	if operation.Rotation != nil {
		transform["rotation"] = cloudAgentPrevisVec3(*operation.Rotation)
	}
	if operation.Scale != nil {
		transform["scale"] = cloudAgentPrevisVec3(*operation.Scale)
	}
	return nil
}

// cloudAgentPrevisGroundScene mirrors web/src/lib/canvas/previs/previs-grounding.ts:
// actors are locked to y=0 (static transform, keyframes and motion path);
// other objects may be raised but never sink below the ground.
func cloudAgentPrevisGroundScene(scene map[string]any) {
	for _, object := range creationMaps(scene["objects"]) {
		locked := stringValue(object["kind"]) == "actor" || stringValue(object["primitive"]) == "character"
		if transform, ok := object["transform"].(map[string]any); ok {
			cloudAgentPrevisGroundPosition(transform, locked)
		}
		for _, keyframe := range creationMaps(object["keyframes"]) {
			if transform, ok := keyframe["transform"].(map[string]any); ok {
				cloudAgentPrevisGroundPosition(transform, locked)
			}
		}
		if !locked {
			continue
		}
		if path, ok := object["motionPath"].(map[string]any); ok {
			if points, ok := path["points"].([]any); ok {
				for _, point := range points {
					if vec, ok := point.([]any); ok && len(vec) == 3 {
						vec[1] = 0.0
					}
				}
			}
		}
	}
}

func cloudAgentPrevisGroundPosition(transform map[string]any, locked bool) {
	position, ok := transform["position"].([]any)
	if !ok || len(position) != 3 {
		return
	}
	y := numberValue(position[1], 0)
	if locked || math.IsNaN(y) || math.IsInf(y, 0) || y < -0.005 {
		position[1] = 0.0
	}
}

func cloudAgentPrevisApplyName(item map[string]any, value *string, label string) error {
	if value == nil {
		return nil
	}
	if err := cloudAgentPrevisValidateText(*value, label, cloudAgentPrevisTextLimit, true); err != nil {
		return err
	}
	item["name"] = *value
	return nil
}

func cloudAgentPrevisApplyCharacterBinding(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	// characterName is descriptive metadata for a real character-card binding;
	// a name on an actor from an ordinary reference image must not trigger binding.
	provided := operation.CharacterAssetID != nil || operation.CharacterVersionID != nil || operation.ReferenceNodeID != nil
	if !provided {
		return nil
	}
	if operation.CharacterAssetID == nil || operation.CharacterVersionID == nil || operation.ReferenceNodeID == nil {
		return BadAuthRequest("Character binding needs characterAssetId, characterVersionId and referenceNodeId")
	}
	for value, label := range map[*string]string{
		operation.CharacterAssetID:   "characterAssetId",
		operation.CharacterVersionID: "characterVersionId",
		operation.ReferenceNodeID:    "referenceNodeId",
	} {
		if value == nil || strings.TrimSpace(*value) == "" {
			return BadAuthRequest(label + " must not be empty")
		}
		if err := validateCloudAgentID(*value, label, 120); err != nil {
			return err
		}
	}
	binding := map[string]any{
		"characterAssetId":   *operation.CharacterAssetID,
		"characterVersionId": *operation.CharacterVersionID,
		"referenceNodeId":    *operation.ReferenceNodeID,
	}
	if operation.CharacterName != nil {
		if err := cloudAgentPrevisValidateText(*operation.CharacterName, "characterName", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		binding["characterName"] = *operation.CharacterName
	}
	item["characterBinding"] = binding
	item["sourceNodeId"] = *operation.ReferenceNodeID
	return nil
}

func cloudAgentPrevisValidateCharacterBindingInCanvas(doc map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if operation.CharacterAssetID == nil && operation.CharacterVersionID == nil && operation.ReferenceNodeID == nil {
		return nil
	}
	if operation.CharacterAssetID == nil || operation.CharacterVersionID == nil || operation.ReferenceNodeID == nil {
		return BadAuthRequest("Character binding needs characterAssetId, characterVersionId and referenceNodeId")
	}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != *operation.ReferenceNodeID {
			continue
		}
		metadata, _ := node["metadata"].(map[string]any)
		if stringValue(metadata["workflowKind"]) != "character" || stringValue(metadata["characterAssetId"]) != *operation.CharacterAssetID || stringValue(metadata["characterVersionId"]) != *operation.CharacterVersionID {
			return BadAuthRequest("referenceNodeId must be a character card node matching characterAssetId and characterVersionId")
		}
		return nil
	}
	return BadAuthRequest("referenceNodeId does not belong to this canvas")
}

func cloudAgentPrevisShotDuration(scene map[string]any) float64 {
	for _, shot := range creationMaps(scene["shots"]) {
		if stringValue(shot["id"]) == stringValue(scene["activeShotId"]) {
			return numberValue(shot["duration"], 5)
		}
	}
	return 5
}

func cloudAgentPrevisKeyframeTransform(item map[string]any, operation cloudAgentPrevisPatchOperation) (map[string]any, error) {
	transform := cloudAgentPrevisMapTransform(item)
	result := map[string]any{}
	for _, key := range []string{"position", "rotation", "scale"} {
		value, ok := cloudAgentPrevisNumberVec3(transform[key])
		if !ok {
			return nil, BadAuthRequest("Keyframe target object transform is invalid")
		}
		result[key] = cloudAgentPrevisVec3(value)
	}
	for value, key := range map[*[]float64]string{operation.Position: "position", operation.Rotation: "rotation", operation.Scale: "scale"} {
		if value == nil {
			continue
		}
		if err := cloudAgentPrevisValidateVec3(*value, key); err != nil {
			return nil, err
		}
		result[key] = cloudAgentPrevisVec3(*value)
	}
	return result, nil
}

func cloudAgentPrevisValidateEasing(value string) error {
	if value == "" {
		return nil
	}
	return cloudAgentPrevisValidateEnum(value, "Keyframe easing", "step", "linear", "smooth")
}

func cloudAgentPrevisUpsertKeyframe(item map[string]any, operation cloudAgentPrevisPatchOperation, duration float64) error {
	if operation.Time == nil {
		return BadAuthRequest("Keyframe operations need time")
	}
	if err := cloudAgentPrevisFiniteInRange(*operation.Time, "Keyframe time", 0, duration); err != nil {
		return err
	}
	if err := cloudAgentPrevisValidateEasing(operation.Easing); err != nil {
		return err
	}
	transform, err := cloudAgentPrevisKeyframeTransform(item, operation)
	if err != nil {
		return err
	}
	keyframes := creationMaps(item["keyframes"])
	keyframeID := ""
	if operation.KeyframeID != nil {
		if err := validateCloudAgentID(*operation.KeyframeID, "keyframeId", 120); err != nil {
			return err
		}
		keyframeID = *operation.KeyframeID
	}
	match := -1
	for index, keyframe := range keyframes {
		if (keyframeID != "" && stringValue(keyframe["id"]) == keyframeID) || math.Abs(numberValue(keyframe["time"], math.NaN())-*operation.Time) < 0.001 {
			match = index
			break
		}
	}
	if match < 0 {
		if keyframeID == "" {
			keyframeID = fmt.Sprintf("%s-kf-%d", stringValue(item["id"]), len(keyframes)+1)
		}
		keyframe := map[string]any{"id": keyframeID, "time": *operation.Time, "transform": transform}
		if operation.Easing != "" {
			keyframe["easing"] = operation.Easing
		}
		keyframes = append(keyframes, keyframe)
	} else {
		keyframes[match]["id"] = keyframeIDOrExisting(keyframeID, keyframes[match])
		keyframes[match]["time"] = *operation.Time
		keyframes[match]["transform"] = transform
		if operation.Easing == "" {
			delete(keyframes[match], "easing")
		} else {
			keyframes[match]["easing"] = operation.Easing
		}
	}
	for i := range keyframes {
		for j := i + 1; j < len(keyframes); j++ {
			if numberValue(keyframes[j]["time"], 0) < numberValue(keyframes[i]["time"], 0) {
				keyframes[i], keyframes[j] = keyframes[j], keyframes[i]
			}
		}
	}
	item["keyframes"] = keyframes
	return nil
}

func keyframeIDOrExisting(requested string, existing map[string]any) string {
	if requested != "" {
		return requested
	}
	return stringValue(existing["id"])
}

func cloudAgentPrevisRemoveKeyframe(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if operation.KeyframeID == nil || strings.TrimSpace(*operation.KeyframeID) == "" {
		return BadAuthRequest("Removing a keyframe needs keyframeId")
	}
	if err := validateCloudAgentID(*operation.KeyframeID, "keyframeId", 120); err != nil {
		return err
	}
	keyframes := creationMaps(item["keyframes"])
	filtered := make([]map[string]any, 0, len(keyframes))
	for _, keyframe := range keyframes {
		if stringValue(keyframe["id"]) != *operation.KeyframeID {
			filtered = append(filtered, keyframe)
		}
	}
	if len(filtered) == len(keyframes) {
		return BadAuthRequest("Target keyframe does not exist")
	}
	item["keyframes"] = filtered
	return nil
}

func cloudAgentPrevisSetMotionPath(item map[string]any, operation cloudAgentPrevisPatchOperation, duration float64) error {
	if len(operation.PathPoints) < 2 || len(operation.PathPoints) > 64 {
		return BadAuthRequest("motion path needs between 2 and 64 points")
	}
	for index, point := range operation.PathPoints {
		if err := cloudAgentPrevisValidateVec3(point, fmt.Sprintf("pathPoints[%d]", index)); err != nil {
			return err
		}
	}
	speed := operation.PathSpeed
	if speed == "" {
		speed = "walk"
	}
	if err := cloudAgentPrevisValidateEnum(speed, "pathSpeed", "slow", "walk", "run"); err != nil {
		return err
	}
	startDelay := 0.0
	if operation.StartDelay != nil {
		startDelay = *operation.StartDelay
	}
	if err := cloudAgentPrevisFiniteInRange(startDelay, "startDelay", 0, duration); err != nil {
		return err
	}
	orient := false
	if operation.OrientToPath != nil {
		orient = *operation.OrientToPath
	}
	points := make([]any, 0, len(operation.PathPoints))
	for _, point := range operation.PathPoints {
		points = append(points, cloudAgentPrevisVec3(point))
	}
	keyframes, err := cloudAgentPrevisPathKeyframes(item, operation.PathPoints, speed, startDelay, duration, orient)
	if err != nil {
		return err
	}
	item["motionPath"] = map[string]any{"points": points, "speed": speed, "startDelay": startDelay, "orientToPath": orient}
	// 与 UI 画走位一致：整条路径接管 transform 轨道，避免走完后跳回旧手工帧。
	item["keyframes"] = keyframes
	return nil
}

// cloudAgentPrevisFocalToFov 按 36mm 传感器宽度换算水平视角，与前端 previsHorizontalFov 一致。
func cloudAgentPrevisFocalToFov(focalLength float64) float64 {
	return 2 * math.Atan(36.0/(2*math.Max(1, focalLength))) * 180 / math.Pi
}

var cloudAgentPrevisPathSpeeds = map[string]float64{"slow": 0.7, "walk": 1.4, "run": 3.5}

// cloudAgentPrevisPathKeyframes 按路径长度与步速把路径点映射到时间：startDelay 前停在起点，
// 走完路径后停在终点；时长不够时压缩到镜头结束。orientToPath 时按行进方向转身。
func cloudAgentPrevisPathKeyframes(item map[string]any, points [][]float64, speed string, startDelay, duration float64, orient bool) ([]map[string]any, error) {
	available := duration - startDelay
	transform := cloudAgentPrevisMapTransform(item)
	rotation, ok := cloudAgentPrevisNumberVec3(transform["rotation"])
	if !ok {
		rotation = []float64{0, 0, 0}
	}
	scale, ok := cloudAgentPrevisNumberVec3(transform["scale"])
	if !ok {
		scale = []float64{1, 1, 1}
	}
	cumulative := make([]float64, len(points))
	for index := 1; index < len(points); index++ {
		a, b := points[index-1], points[index]
		cumulative[index] = cumulative[index-1] + math.Sqrt((b[0]-a[0])*(b[0]-a[0])+(b[1]-a[1])*(b[1]-a[1])+(b[2]-a[2])*(b[2]-a[2]))
	}
	total := cumulative[len(points)-1]
	if total < 0.01 {
		return nil, BadAuthRequest("motion path start and end are too close to form blocking")
	}
	travel := math.Min(available, total/cloudAgentPrevisPathSpeeds[speed])
	id := stringValue(item["id"])
	heading := func(index int) float64 {
		from, to := points[max(0, index-1)], points[min(len(points)-1, index+1)]
		dx, dz := to[0]-from[0], to[2]-from[2]
		if math.Hypot(dx, dz) < 1e-6 {
			return rotation[1]
		}
		return math.Atan2(dx, dz)
	}
	frame := func(suffix string, time float64, point []float64, yaw float64) map[string]any {
		return map[string]any{
			"id": fmt.Sprintf("%s-path-%s", id, suffix), "time": math.Round(time*1000) / 1000, "easing": "linear",
			"transform": map[string]any{"position": cloudAgentPrevisVec3(point), "rotation": []any{rotation[0], yaw, rotation[2]}, "scale": cloudAgentPrevisVec3(scale)},
		}
	}
	yawAt := func(index int) float64 {
		if orient {
			return heading(index)
		}
		return rotation[1]
	}
	if available <= 0.05 {
		// 镜头结束时才出发：画面内不会移动，只保留起点站位。
		return []map[string]any{frame("hold", startDelay, points[0], yawAt(0))}, nil
	}
	result := make([]map[string]any, 0, len(points)+1)
	if startDelay > 0 {
		result = append(result, frame("hold", 0, points[0], yawAt(0)))
	}
	for index, point := range points {
		result = append(result, frame(fmt.Sprintf("%d", index+1), startDelay+travel*cumulative[index]/total, point, yawAt(index)))
	}
	return result, nil
}

func cloudAgentPrevisApplyObjectPatch(objects *[]map[string]any, operation cloudAgentPrevisPatchOperation, index int) (cloudAgentApprovalPreviewItem, error) {
	items := *objects
	byID, err := cloudAgentPrevisIDSet(items, "Previs object ID")
	if err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if err := validateCloudAgentID(operation.ID, fmt.Sprintf("operations[%d].id", index), 80); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	existing := byID[operation.ID]
	summary := ""
	switch operation.Type {
	case "object_add":
		if existing != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New object ID already exists")
		}
		if operation.Kind != "primitive" && operation.Kind != "actor" {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New object kind must be primitive or actor")
		}
		primitive := operation.Primitive
		if primitive == "" {
			// 演员缺省必须是人形；旧逻辑默认 box 会让 Agent 新增的演员渲染成方块。
			primitive = "box"
			if operation.Kind == "actor" {
				primitive = "character"
			}
		}
		if primitive != "box" && primitive != "sphere" && primitive != "cylinder" && primitive != "plane" && primitive != "character" {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New object primitive is not supported")
		}
		name := "New object"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "Object name", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		position, rotation, scale := []float64{0, 0.5, 0}, []float64{0, 0, 0}, []float64{1, 1, 1}
		if operation.Position != nil {
			position = *operation.Position
		}
		if operation.Rotation != nil {
			rotation = *operation.Rotation
		}
		if operation.Scale != nil {
			scale = *operation.Scale
		}
		if err := cloudAgentPrevisValidateVec3(position, "position"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(rotation, "rotation"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(scale, "scale"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "Object color"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		if operation.Pose != "" {
			if err := cloudAgentPrevisValidatePose(operation.Pose); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		if operation.ParentID != nil && *operation.ParentID != "" {
			if err := validateCloudAgentID(*operation.ParentID, "Object parentId", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		defaultColor := "#8795a5"
		if operation.Kind == "actor" {
			// Assign a distinct colour based on current actor count so each new actor stands out
			actorCount := 0
			for _, obj := range items {
				if stringValue(obj["kind"]) == "actor" {
					actorCount++
				}
			}
			actorColors := []string{"#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#e879f9"}
			defaultColor = actorColors[actorCount%len(actorColors)]
		}
		item := map[string]any{"id": operation.ID, "name": name, "kind": operation.Kind, "primitive": primitive, "transform": map[string]any{"position": cloudAgentPrevisVec3(position), "rotation": cloudAgentPrevisVec3(rotation), "scale": cloudAgentPrevisVec3(scale)}, "color": defaultColor, "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}}
		if operation.Color != nil {
			item["color"] = *operation.Color
		}
		if operation.Visible != nil {
			item["visible"] = *operation.Visible
		}
		if operation.Pose != "" {
			item["pose"] = operation.Pose
		}
		if operation.Kind == "actor" && operation.Pose == "" {
			item["pose"] = "stand"
		}
		if operation.Kind == "actor" {
			item["archetype"] = "adult"
			item["boneTracks"] = []any{}
			item["boneOverrides"] = map[string]any{}
			item["motionClips"] = []any{}
		}
		if operation.Archetype != "" {
			validArchetypes := map[string]bool{"adult": true, "child": true, "elderly": true, "man": true, "woman": true, "monster": true}
			if !validArchetypes[operation.Archetype] {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("archetype value is not supported")
			}
			item["archetype"] = operation.Archetype
		}
		if operation.ParentID != nil && *operation.ParentID != "" {
			item["parentId"] = *operation.ParentID
		}
		if err := cloudAgentPrevisApplyCharacterBinding(item, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		items = append(items, item)
		summary = fmt.Sprintf("Add object '%s'", name)
	case "object_update":
		if existing == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("The object to update does not exist")
		}
		if err := cloudAgentPrevisApplyName(existing, operation.Name, "Object name"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "Object color"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			existing["color"] = *operation.Color
		}
		if operation.Visible != nil {
			existing["visible"] = *operation.Visible
		}
		if operation.Pose != "" {
			if err := cloudAgentPrevisValidatePose(operation.Pose); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			existing["pose"] = operation.Pose
		}
		if operation.ParentID != nil {
			if *operation.ParentID == "" {
				delete(existing, "parentId")
			} else {
				if err := validateCloudAgentID(*operation.ParentID, "Object parentId", 80); err != nil {
					return cloudAgentApprovalPreviewItem{}, err
				}
				existing["parentId"] = *operation.ParentID
			}
		}
		if err := cloudAgentPrevisApplyCharacterBinding(existing, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisApplyTransform(existing, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		summary = fmt.Sprintf("Change object '%s'", stringValue(existing["name"]))
	case "object_remove":
		if existing == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("The object to remove does not exist")
		}
		for _, candidate := range items {
			if stringValue(candidate["parentId"]) == operation.ID {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("A parent object cannot be removed while it has children")
			}
		}
		for i, candidate := range items {
			if stringValue(candidate["id"]) == operation.ID {
				items = append(items[:i], items[i+1:]...)
				break
			}
		}
		summary = fmt.Sprintf("Remove object '%s'", stringValue(existing["name"]))
	default:
		return cloudAgentApprovalPreviewItem{}, nil
	}
	*objects = items
	nodeTitle := stringValue(existing["name"])
	if nodeTitle == "" && operation.Type == "object_add" {
		nodeTitle = "New object"
		if operation.Name != nil {
			nodeTitle = *operation.Name
		}
	}
	return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: truncateRunes(nodeTitle, cloudAgentPrevisTextLimit), Summary: summary}, nil
}

func cloudAgentPrevisFindByID(items []map[string]any, id string) map[string]any {
	for _, item := range items {
		if stringValue(item["id"]) == id {
			return item
		}
	}
	return nil
}

func cloudAgentPrevisApplyPatchOperation(scene map[string]any, operation cloudAgentPrevisPatchOperation, index int) (cloudAgentApprovalPreviewItem, error) {
	if err := cloudAgentPrevisValidateText(operation.Type, fmt.Sprintf("operations[%d].type", index), 40, true); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if err := validateCloudAgentID(operation.ID, fmt.Sprintf("operations[%d].id", index), 80); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if operation.Type == "scene_update" && operation.ID != stringValue(scene["id"]) {
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest("scene_update id must be the current scene ID")
	}
	objects, cameras, lights, shots := creationMaps(scene["objects"]), creationMaps(scene["cameras"]), creationMaps(scene["lights"]), creationMaps(scene["shots"])
	switch operation.Type {
	case "scene_update":
		if operation.Title != nil {
			if err := cloudAgentPrevisValidateText(*operation.Title, "Scene title", cloudAgentPrevisTextLimit, true); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["title"] = *operation.Title
		}
		if operation.Background != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Background, "Scene background color"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["background"] = *operation.Background
		}
		if operation.EnvironmentIntensity != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.EnvironmentIntensity, "environmentIntensity", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["environmentIntensity"] = *operation.EnvironmentIntensity
		}
		if operation.GridVisible != nil {
			scene["gridVisible"] = *operation.GridVisible
		}
		if operation.ActiveShotID != nil {
			if *operation.ActiveShotID == "" {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("activeShotId must not be empty")
			}
			if err := validateCloudAgentID(*operation.ActiveShotID, "activeShotId", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["activeShotId"] = *operation.ActiveShotID
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: stringValue(scene["id"]), NodeTitle: stringValue(scene["title"]), Summary: "Change scene settings"}, nil
	case "object_add", "object_update", "object_remove":
		item, err := cloudAgentPrevisApplyObjectPatch(&objects, operation, index)
		if err == nil {
			scene["objects"] = objects
		}
		return item, err
	case "actor_motion_add", "actor_motion_remove":
		object := cloudAgentPrevisFindByID(objects, operation.ID)
		if object == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target object does not exist")
		}
		if err := cloudAgentPrevisApplyActorMotion(object, operation, cloudAgentPrevisShotDuration(scene)); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		scene["objects"] = objects
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(object["name"]), Summary: fmt.Sprintf("Change motion of actor '%s'", stringValue(object["name"]))}, nil
	case "object_keyframe_upsert", "object_keyframe_remove", "object_motion_path_set", "object_motion_path_clear":
		object := cloudAgentPrevisFindByID(objects, operation.ID)
		if object == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target object does not exist")
		}
		duration := cloudAgentPrevisShotDuration(scene)
		var err error
		switch operation.Type {
		case "object_keyframe_upsert":
			err = cloudAgentPrevisUpsertKeyframe(object, operation, duration)
		case "object_keyframe_remove":
			err = cloudAgentPrevisRemoveKeyframe(object, operation)
		case "object_motion_path_set":
			err = cloudAgentPrevisSetMotionPath(object, operation, duration)
		case "object_motion_path_clear":
			delete(object, "motionPath")
			object["keyframes"] = []map[string]any{}
		}
		if err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		scene["objects"] = objects
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(object["name"]), Summary: fmt.Sprintf("Change animation of object '%s'", stringValue(object["name"]))}, nil
	case "shot_add":
		if cloudAgentPrevisFindByID(shots, operation.ID) != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New shot ID already exists")
		}
		cameraID := ""
		if operation.CameraID != nil {
			if err := validateCloudAgentID(*operation.CameraID, "Camera ID", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			cameraID = *operation.CameraID
		} else if len(cameras) > 0 {
			cameraID = stringValue(cameras[0]["id"])
		}
		if cloudAgentPrevisFindByID(cameras, cameraID) == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("A new shot must reference an existing camera")
		}
		name := "New shot"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "Shot name", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		duration, fps := 5.0, 24
		if operation.Duration != nil {
			duration = *operation.Duration
		}
		if operation.FPS != nil {
			fps = *operation.FPS
		}
		if err := cloudAgentPrevisFiniteInRange(duration, "Shot duration", 0.1, 60); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if fps < 1 || fps > 60 {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Shot frame rate is out of range")
		}
		shotSize, cameraMove := operation.ShotSize, operation.CameraMove
		if shotSize == "" {
			shotSize = "medium"
		}
		if cameraMove == "" {
			cameraMove = "static"
		}
		if err := cloudAgentPrevisValidateEnum(shotSize, "Shot size", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateEnum(cameraMove, "Shot camera move", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		shot := map[string]any{"id": operation.ID, "name": name, "cameraId": cameraID, "duration": duration, "fps": fps, "shotSize": shotSize, "cameraMove": cameraMove, "prompt": "", "cuts": []any{}}
		if operation.Prompt != nil {
			if err := cloudAgentPrevisValidateText(*operation.Prompt, "Shot prompt", 2000, false); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["prompt"] = *operation.Prompt
		}
		scene["shots"] = append(shots, shot)
		if stringValue(scene["activeShotId"]) == "" {
			scene["activeShotId"] = operation.ID
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("Add shot '%s'", name)}, nil
	case "shot_update", "shot_remove":
		shot := cloudAgentPrevisFindByID(shots, operation.ID)
		if shot == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target shot does not exist")
		}
		if operation.Type == "shot_remove" {
			if len(shots) <= 1 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("A previs scene must keep at least one shot")
			}
			next := make([]map[string]any, 0, len(shots)-1)
			for _, item := range shots {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["shots"] = next
			if stringValue(scene["activeShotId"]) == operation.ID {
				scene["activeShotId"] = stringValue(next[0]["id"])
			}
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(shot["name"]), Summary: fmt.Sprintf("Remove shot '%s'", stringValue(shot["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(shot, operation.Name, "Shot name"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.CameraID != nil {
			if err := validateCloudAgentID(*operation.CameraID, "Camera ID", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if cloudAgentPrevisFindByID(cameras, *operation.CameraID) == nil {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("The camera referenced by the shot does not exist")
			}
			shot["cameraId"] = *operation.CameraID
		}
		if operation.Duration != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Duration, "Shot duration", 0.1, 60); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["duration"] = *operation.Duration
		}
		if operation.FPS != nil {
			if *operation.FPS < 1 || *operation.FPS > 60 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Shot frame rate is out of range")
			}
			shot["fps"] = *operation.FPS
		}
		if operation.ShotSize != "" {
			if err := cloudAgentPrevisValidateEnum(operation.ShotSize, "Shot size", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["shotSize"] = operation.ShotSize
		}
		if operation.CameraMove != "" {
			if err := cloudAgentPrevisValidateEnum(operation.CameraMove, "Shot camera move", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["cameraMove"] = operation.CameraMove
		}
		if operation.Prompt != nil {
			if err := cloudAgentPrevisValidateText(*operation.Prompt, "Shot prompt", 2000, false); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["prompt"] = *operation.Prompt
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(shot["name"]), Summary: fmt.Sprintf("Change shot '%s'", stringValue(shot["name"]))}, nil
	case "camera_keyframe_upsert", "camera_keyframe_remove":
		camera := cloudAgentPrevisFindByID(cameras, operation.ID)
		if camera == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target camera does not exist")
		}
		duration := cloudAgentPrevisShotDuration(scene)
		var err error
		if operation.Type == "camera_keyframe_upsert" {
			err = cloudAgentPrevisUpsertKeyframe(camera, operation, duration)
		} else {
			err = cloudAgentPrevisRemoveKeyframe(camera, operation)
		}
		if err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("Change animation of camera '%s'", stringValue(camera["name"]))}, nil
	case "camera_add":
		if cloudAgentPrevisFindByID(cameras, operation.ID) != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New camera ID already exists")
		}
		name := "Camera"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "Camera name", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		camPos := []float64{4.8, 2.7, 6.8}
		camRot := []float64{0, 0, 0}
		camScale := []float64{1, 1, 1}
		camTarget := []float64{0, 1, 0}
		if operation.Position != nil {
			camPos = *operation.Position
		}
		if operation.Rotation != nil {
			camRot = *operation.Rotation
		}
		if operation.Scale != nil {
			camScale = *operation.Scale
		}
		if operation.Target != nil {
			camTarget = *operation.Target
		}
		if err := cloudAgentPrevisValidateVec3(camPos, "Camera position"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(camTarget, "Camera target"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		focalLength := 35.0
		if operation.FocalLength != nil {
			focalLength = *operation.FocalLength
		}
		if err := cloudAgentPrevisFiniteInRange(focalLength, "Camera focal length", 1, 300); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		fov := cloudAgentPrevisFocalToFov(focalLength)
		newCamera := map[string]any{
			"id": operation.ID, "name": name,
			"transform": map[string]any{"position": cloudAgentPrevisVec3(camPos), "rotation": cloudAgentPrevisVec3(camRot), "scale": cloudAgentPrevisVec3(camScale)},
			"target":    cloudAgentPrevisVec3(camTarget), "focalLength": focalLength, "fov": fov,
			"aperture": 2.8, "focusDistance": 5.0, "near": 0.05, "far": 500.0, "keyframes": []any{},
		}
		scene["cameras"] = append(cameras, newCamera)
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("Add camera '%s'", name)}, nil
	case "camera_update", "camera_remove":
		camera := cloudAgentPrevisFindByID(cameras, operation.ID)
		if camera == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target camera does not exist")
		}
		if operation.Type == "camera_remove" {
			if len(cameras) <= 1 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("A previs scene must keep at least one camera")
			}
			for _, shot := range shots {
				if stringValue(shot["cameraId"]) == operation.ID {
					return cloudAgentApprovalPreviewItem{}, BadAuthRequest("The camera is still used by a shot and cannot be removed")
				}
			}
			next := make([]map[string]any, 0, len(cameras)-1)
			for _, item := range cameras {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["cameras"] = next
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("Remove camera '%s'", stringValue(camera["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(camera, operation.Name, "Camera name"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.FocalLength != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.FocalLength, "Camera focal length", 1, 300); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			camera["focalLength"] = *operation.FocalLength
			// 焦段与 fov 必须同时写：只改焦段时旧客户端仍按 fov 取景，画面会不变。
			camera["fov"] = cloudAgentPrevisFocalToFov(*operation.FocalLength)
		}
		if operation.Target != nil {
			if err := cloudAgentPrevisValidateVec3(*operation.Target, "target"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			camera["target"] = cloudAgentPrevisVec3(*operation.Target)
		}
		if err := cloudAgentPrevisApplyTransform(camera, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("Change camera '%s'", stringValue(camera["name"]))}, nil
	case "light_add", "light_update", "light_remove":
		if operation.Type == "light_add" {
			if cloudAgentPrevisFindByID(lights, operation.ID) != nil {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("New light ID already exists")
			}
			name := "New light"
			if operation.Name != nil {
				name = *operation.Name
			}
			if err := cloudAgentPrevisValidateText(name, "Light name", cloudAgentPrevisTextLimit, true); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			lightType := "point"
			if operation.LightType != nil {
				lightType = *operation.LightType
			}
			if err := cloudAgentPrevisValidateEnum(lightType, "Light type", "directional", "point", "spot", "ambient"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			position, rotation, scale := []float64{0, 3, 0}, []float64{0, 0, 0}, []float64{1, 1, 1}
			if operation.Position != nil {
				position = *operation.Position
			}
			if operation.Rotation != nil {
				rotation = *operation.Rotation
			}
			if operation.Scale != nil {
				scale = *operation.Scale
			}
			if err := cloudAgentPrevisValidateVec3(position, "position"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisValidateVec3(rotation, "rotation"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisValidateVec3(scale, "scale"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			intensity := 1.0
			if operation.Intensity != nil {
				intensity = *operation.Intensity
			}
			if err := cloudAgentPrevisFiniteInRange(intensity, "Light intensity", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			angle, penumbra := math.Pi/4, 0.35
			if operation.Angle != nil {
				angle = *operation.Angle
			}
			if operation.Penumbra != nil {
				penumbra = *operation.Penumbra
			}
			if err := cloudAgentPrevisFiniteInRange(angle, "Light angle", 0, 6.29); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisFiniteInRange(penumbra, "Light penumbra", 0, 1); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			color := "#ffffff"
			if operation.Color != nil {
				if err := cloudAgentPrevisValidateColor(*operation.Color, "Light color"); err != nil {
					return cloudAgentApprovalPreviewItem{}, err
				}
				color = *operation.Color
			}
			castShadow := lightType != "ambient"
			if operation.CastShadow != nil {
				castShadow = *operation.CastShadow
			}
			light := map[string]any{"id": operation.ID, "name": name, "type": lightType, "transform": map[string]any{"position": cloudAgentPrevisVec3(position), "rotation": cloudAgentPrevisVec3(rotation), "scale": cloudAgentPrevisVec3(scale)}, "color": color, "intensity": intensity, "angle": angle, "penumbra": penumbra, "castShadow": castShadow}
			scene["lights"] = append(lights, light)
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("Add light '%s'", name)}, nil
		}
		light := cloudAgentPrevisFindByID(lights, operation.ID)
		if light == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Target light does not exist")
		}
		if operation.Type == "light_remove" {
			next := make([]map[string]any, 0, len(lights)-1)
			for _, item := range lights {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["lights"] = next
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(light["name"]), Summary: fmt.Sprintf("Remove light '%s'", stringValue(light["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(light, operation.Name, "Light name"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.LightType != nil {
			if err := cloudAgentPrevisValidateEnum(*operation.LightType, "Light type", "directional", "point", "spot", "ambient"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["type"] = *operation.LightType
		}
		if operation.Intensity != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Intensity, "Light intensity", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["intensity"] = *operation.Intensity
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "Light color"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["color"] = *operation.Color
		}
		if operation.Angle != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Angle, "Light angle", 0, 6.29); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["angle"] = *operation.Angle
		}
		if operation.Penumbra != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Penumbra, "Light penumbra", 0, 1); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["penumbra"] = *operation.Penumbra
		}
		if operation.CastShadow != nil {
			light["castShadow"] = *operation.CastShadow
		}
		if err := cloudAgentPrevisApplyTransform(light, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(light["name"]), Summary: fmt.Sprintf("Change light '%s'", stringValue(light["name"]))}, nil
	default:
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest("Unsupported previs semantic operation")
	}
}

func applyCloudAgentPrevisMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	var plan *cloudAgentPrevisMutationPlan
	var err error
	switch call.Function.Name {
	case "previs_scene_create":
		plan, err = prepareCloudAgentPrevisSceneCreate(repo, userID, canvasID, call)
	case "previs_apply_patch":
		plan, err = prepareCloudAgentPrevisApplyPatch(repo, userID, canvasID, call)
	default:
		return nil, BadAuthRequest("Unsupported previs write tool")
	}
	if err != nil {
		return nil, err
	}
	if err = saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	appliedPreview := cloudAgentCanvasAppliedPreview(plan.Preview)
	afterCanvasHash := cloudAgentCanvasHash(plan.Document)
	afterSceneHash := plan.ResultSnapshotHash
	if scene, ok := findPrevisScene(creationMaps(plan.Document["previsScenes"]), plan.SceneID); ok {
		afterSceneHash = creationHash(scene)
	}
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: plan.Operation, BeforeSnapshotHash: plan.BeforeSnapshotHash, AfterSnapshotHash: afterCanvasHash, BeforeJSON: plan.BeforeJSON, Preview: &appliedPreview}); err != nil {
			return nil, err
		}
	}
	resultSnapshotHash := afterSceneHash
	if resultSnapshotHash == "" {
		resultSnapshotHash = afterCanvasHash
	}
	return map[string]any{"canvasId": canvasID, "sceneId": plan.SceneID, "nodeId": plan.NodeID, "shotId": plan.ShotID, "snapshotHash": resultSnapshotHash, "canvasSnapshotHash": afterCanvasHash, "committed": true, "summary": appliedPreview.Description, "preview": appliedPreview}, nil
}

// cloudAgentPrevisMotionIDs 与前端 PREVIS_MOTIONS（previs-motion.ts）一一对应。
var cloudAgentPrevisMotionIDs = []string{"idle", "walk", "run", "talk", "wave", "nod", "shake_head", "look_around", "point", "phone_call", "sit_idle", "clap", "fight_idle", "punch", "jump", "fall", "cry", "cheer", "slap", "hold_hand", "hit_react"}

const cloudAgentPrevisMaxActorMotions = 32

// cloudAgentPrevisApplyActorMotion 在演员时间轴上插入/删除程序化动作片段。移动步态由位移自动推导，不需要写 walk/run。
func cloudAgentPrevisApplyActorMotion(object map[string]any, operation cloudAgentPrevisPatchOperation, duration float64) error {
	if stringValue(object["kind"]) != "actor" && stringValue(object["primitive"]) != "character" {
		return BadAuthRequest("Only actors can have motions")
	}
	motions := creationMaps(object["motions"])
	if operation.Type == "actor_motion_remove" {
		if operation.KeyframeID == nil || *operation.KeyframeID == "" {
			return BadAuthRequest("Removing a motion needs the motion id in keyframeId")
		}
		filtered := make([]map[string]any, 0, len(motions))
		for _, item := range motions {
			if stringValue(item["id"]) != *operation.KeyframeID {
				filtered = append(filtered, item)
			}
		}
		if len(filtered) == len(motions) {
			return BadAuthRequest("Target motion does not exist")
		}
		object["motions"] = filtered
		return nil
	}
	if err := cloudAgentPrevisValidateEnum(operation.Motion, "Motion", cloudAgentPrevisMotionIDs...); err != nil {
		return err
	}
	if len(motions) >= cloudAgentPrevisMaxActorMotions {
		return BadAuthRequest("An actor can have at most 32 motion clips")
	}
	start := 0.0
	if operation.Time != nil {
		start = *operation.Time
	}
	if err := cloudAgentPrevisFiniteInRange(start, "Motion start time", 0, duration); err != nil {
		return err
	}
	length := math.Max(0.2, duration-start)
	if operation.Duration != nil {
		length = *operation.Duration
	}
	if err := cloudAgentPrevisFiniteInRange(length, "Motion duration", 0.2, 60); err != nil {
		return err
	}
	intensity := 1.0
	if operation.Intensity != nil {
		intensity = *operation.Intensity
	}
	if err := cloudAgentPrevisFiniteInRange(intensity, "Motion intensity", 0.2, 2); err != nil {
		return err
	}
	id := fmt.Sprintf("%s-motion-%d", stringValue(object["id"]), len(motions)+1)
	if operation.KeyframeID != nil && *operation.KeyframeID != "" {
		if err := validateCloudAgentID(*operation.KeyframeID, "Motion id", 120); err != nil {
			return err
		}
		id = *operation.KeyframeID
	}
	for _, item := range motions {
		if stringValue(item["id"]) == id {
			return BadAuthRequest("Motion id already exists")
		}
	}
	object["motions"] = append(motions, map[string]any{"id": id, "motion": operation.Motion, "start": start, "duration": length, "intensity": intensity})
	return nil
}
