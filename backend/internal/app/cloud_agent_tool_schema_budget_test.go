package app

import (
	"bytes"
	"encoding/json"
	"testing"
)

// 工具 schema 是每一步都要发出去（并且是前缀缓存的第一段）的固定开销，因此值得钉住体积：
// 平台工具全集按 auto + canvas + 技能 + 视觉工具构造，覆盖最大条件工具集。
func platformToolSchema(t *testing.T) ([]map[string]any, []byte) {
	t.Helper()
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}, SkillIDs: []string{"capability-list"}, VisionEnabled: true}
	req.Budget.MaxGenerationTasks = 1
	tools := cloudAgentTools(req)
	raw, err := json.Marshal(tools)
	if err != nil {
		t.Fatal(err)
	}
	return tools, raw
}

func TestCloudAgentToolSchemaStaysCompact(t *testing.T) {
	tools, raw := platformToolSchema(t)
	t.Logf("platform tool schema: %d tools, %d bytes", len(tools), len(raw))

	// 条件必填不是 type 枚举能表达的约束，压缩描述不能删掉协议语义。
	found := false
	foundVision := false
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] == "canvas_inspect_image" {
			foundVision = true
		}
		if function["name"] != "canvas_apply_ops" {
			continue
		}
		found = true
		parameters, _ := function["parameters"].(map[string]any)
		ops, _ := parameters["properties"].(map[string]any)
		items, _ := ops["ops"].(map[string]any)
		opItem, _ := items["items"].(map[string]any)
		want := []map[string]any{
			{"properties": map[string]any{"type": map[string]any{"const": "add_node"}}, "required": []string{"nodeType"}},
			{"properties": map[string]any{"type": map[string]any{"const": "update_node"}}, "required": []string{"patch"}},
			{"properties": map[string]any{"type": map[string]any{"const": "connect_nodes"}}, "required": []string{"fromNodeId", "toNodeId"}},
		}
		gotJSON, _ := json.Marshal(opItem["oneOf"])
		wantJSON, _ := json.Marshal(want)
		if !bytes.Equal(gotJSON, wantJSON) {
			t.Fatalf("操作类型条件必填约束丢失: %#v", opItem["oneOf"])
		}
		if props, ok := opItem["properties"].(map[string]any); !ok || len(props) == 0 {
			t.Fatal("canvas_apply_ops 的 ops.items 必须保留 properties")
		}
	}
	if !found {
		t.Fatal("canvas_apply_ops 未暴露")
	}
	if !foundVision {
		t.Fatal("启用视觉能力后 canvas_inspect_image 未暴露")
	}

	// Size budget. The schema is sent on every step at the very start of the prompt prefix, so it must not
	// grow unnoticed. With 29 tools and English descriptions it measures 40,608 bytes (the Chinese version
	// was 36,883). English needs more bytes but fewer tokens per byte than Chinese, so the token cost did not
	// grow; the budget is 41,500, about 2% headroom. When you add a tool or field, measure again and change
	// this number on purpose.
	if len(raw) > 41500 {
		t.Fatalf("platform tool schema is %d bytes, over the 41500 budget: shorten descriptions or raise the budget on purpose", len(raw))
	}
}
