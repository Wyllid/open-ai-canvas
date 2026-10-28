package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSplitMCPCanvasIDRemovesCanvasID(t *testing.T) {
	canvasID, rest, err := splitMCPCanvasID(json.RawMessage(`{"canvasId":" c1 ","nodeIds":["a"]}`))
	if err != nil || canvasID != "c1" || string(rest) != `{"nodeIds":["a"]}` {
		t.Fatalf("got %q %s %v", canvasID, rest, err)
	}
	for _, input := range []string{`{}`, `{"canvasId":""}`, `{"canvasId":1}`, `[]`, `null`} {
		if _, _, err := splitMCPCanvasID(json.RawMessage(input)); err == nil {
			t.Errorf("%s: want an error", input)
		}
	}
}

func TestWithRequiredCanvasIDKeepsExistingFields(t *testing.T) {
	schema, err := withRequiredCanvasID(json.RawMessage(`{"type":"object","properties":{"nodeIds":{"type":"array"}},"required":["nodeIds"],"additionalProperties":false}`))
	if err != nil {
		t.Fatal(err)
	}
	var object struct {
		Properties           map[string]any `json:"properties"`
		Required             []string       `json:"required"`
		AdditionalProperties bool           `json:"additionalProperties"`
	}
	if err := json.Unmarshal(schema, &object); err != nil {
		t.Fatal(err)
	}
	if object.Properties["canvasId"] == nil || object.Properties["nodeIds"] == nil || strings.Join(object.Required, ",") != "canvasId,nodeIds" || object.AdditionalProperties {
		t.Fatalf("schema = %s", schema)
	}
}

func TestMCPToolsExposeOnlyPreparationTools(t *testing.T) {
	tools, err := (&Service{}).MCPTools()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		if seen[tool.Name] {
			t.Fatalf("duplicate tool %s", tool.Name)
		}
		seen[tool.Name] = true
		if !json.Valid(tool.InputSchema) || strings.TrimSpace(tool.Description) == "" {
			t.Fatalf("tool %s has an invalid schema or no description", tool.Name)
		}
		if isMCPCanvasTool(tool.Name) && !strings.Contains(string(tool.InputSchema), `"canvasId"`) {
			t.Fatalf("canvas tool %s does not require canvasId", tool.Name)
		}
		if tool.Name == "generate_media" || tool.Name == "request_approval" || tool.Name == "remember_lesson" {
			t.Fatalf("generation tool %s must stay in the canvas", tool.Name)
		}
	}
	if len(tools) != 15+len(mcpCanvasTools)+len(mcpSkillTools) {
		t.Fatalf("got %d tools", len(tools))
	}
}

func TestMCPDramaEditToolsNeedTheirIDs(t *testing.T) {
	svc := &Service{}
	for name, args := range map[string]string{
		mcpDramaShotUpdate: `{"projectId":"p1","dialogue":"Hi"}`,
		mcpDramaShotInsert: `{"projectId":" ","shotId":"s1","position":"after"}`,
		mcpDramaCastUpdate: `{"castId":"c1"}`,
		mcpDramaEpisodeSet: `{"projectId":"p1","episodeId":"e1","title":"  "}`,
		mcpDramaJobs:       `{"projectId":"p1","unknown":true}`,
	} {
		if _, err := svc.CallMCPTool("user", name, json.RawMessage(args)); err == nil {
			t.Errorf("%s %s: want an argument error", name, args)
		}
	}
}
