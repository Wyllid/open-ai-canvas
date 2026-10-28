package app

import (
	"encoding/json"
	"strings"
)

// The tool schema advertises the alternative selection shapes, while this
// validator remains the authoritative boundary for null, whitespace and
// decoded-value checks that JSON Schema cannot reliably express across all
// provider adapters.
const cloudAgentModelSelectionDescription = "Model: logicalModelId or channelId+channelModelKey, mutually exclusive and complete, never null or blank. generate_media can inherit the draft's model or the single matching candidate of this run; with several candidates it does not pick one for you."

// A model can occasionally omit the copied selection even after reading
// model_list. We may repair that omission only when the exact same query has a
// single candidate. This is deterministic materialization of an explicit
// model_list result, not a project-default or random model fallback.
func cloudAgentApplyUniqueModelListSelection(state *cloudAgentRuntime, raw string, a *cloudAgentMediaArgs) bool {
	if state == nil || a == nil || cloudAgentModelSelectionProvided(raw) || a.LogicalModelID != "" || a.ChannelID != "" || a.ChannelModelKey != "" || len(a.ReferenceTransientIDs) > 0 {
		return false
	}
	for i := len(state.Events) - 1; i >= 0; i-- {
		event := state.Events[i]
		if stringValue(event.Payload["toolName"]) != "model_list" {
			continue
		}
		if event.Type != "tool_completed" {
			return false
		}
		var query struct {
			Mode             string   `json:"mode"`
			ReferenceNodeIDs []string `json:"referenceNodeIds"`
		}
		if err := json.Unmarshal([]byte(stringValue(event.Payload["arguments"])), &query); err != nil || query.Mode != a.Mode || !sameStringSlice(query.ReferenceNodeIDs, a.ReferenceNodeIDs) {
			return false
		}
		result, ok := event.Payload["result"].(map[string]any)
		if !ok {
			return false
		}
		models := creationMaps(result["models"])
		if len(models) != 1 {
			return false
		}
		modelItem := models[0]
		if normalizeCapability(stringValue(modelItem["capability"])) != normalizeCapability(a.Mode) {
			return false
		}
		candidate, ok := modelItem["selection"].(map[string]any)
		if !ok {
			return false
		}
		encoded, err := json.Marshal(candidate)
		if err != nil {
			return false
		}
		var selection cloudAgentMediaArgs
		if decodeCloudAgentJSONObject(string(encoded), &selection) != nil || validateCloudAgentModelSelection(string(encoded), selection) != nil {
			return false
		}
		a.LogicalModelID, a.ChannelID, a.ChannelModelKey = selection.LogicalModelID, selection.ChannelID, selection.ChannelModelKey
		return true
	}
	return false
}

func cloudAgentModelSelectionProvided(raw string) bool {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil || fields == nil {
		return true
	}
	for _, field := range []string{"logicalModelId", "channelId", "channelModelKey"} {
		if _, ok := fields[field]; ok {
			return true
		}
	}
	return false
}

func sameStringSlice(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func validateCloudAgentModelSelection(raw string, a cloudAgentMediaArgs) error {
	// Go's JSON decoder accepts null for string fields; the tool contract does
	// not. Check presence/type before interpreting the decoded selection.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return cloudAgentJSONArgumentError(err)
	}
	for _, field := range []string{"logicalModelId", "channelId", "channelModelKey"} {
		if value, exists := fields[field]; exists {
			var text *string
			if err := json.Unmarshal(value, &text); err != nil || text == nil {
				return cloudAgentFieldError(field, "type_mismatch", "Model selection fields must be strings, not null")
			}
			if *text != "" && strings.TrimSpace(*text) == "" {
				return cloudAgentFieldError(field, "invalid_value", "Model selection fields must not be only whitespace")
			}
		}
	}
	switch {
	case a.LogicalModelID != "" && (a.ChannelID != "" || a.ChannelModelKey != ""):
		return cloudAgentFieldError("logicalModelId", "mutually_exclusive", "Conflicting model selection: logicalModelId and channelId/channelModelKey cannot be combined; copy one selection from model_list")
	case a.LogicalModelID != "":
		return nil
	case a.ChannelID == "" && a.ChannelModelKey == "":
		return cloudAgentFieldError("logicalModelId", "required", "Model selection missing: copy logicalModelId or the complete channelId/channelModelKey from model_list; media generation must name the model explicitly and never uses the project default or a random model")
	case a.ChannelID == "":
		return cloudAgentFieldError("channelId", "required", "Incomplete system channel model selection: channelId is missing; copy the full selection from model_list")
	case a.ChannelModelKey == "":
		return cloudAgentFieldError("channelModelKey", "required", "Incomplete system channel model selection: channelModelKey is missing; copy the full selection from model_list")
	default:
		return nil
	}
}
