package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

// The browser sends one protocol-neutral conversation. Only the selected
// provider body is materialized; declarative plugins retain their request paths.
type canonicalAgentRequest struct {
	Messages       []map[string]interface{} `json:"messages"`
	Tools          []map[string]interface{} `json:"tools"`
	ToolChoice     interface{}              `json:"toolChoice"`
	SystemPrompt   string                   `json:"systemPrompt"`
	PromptCacheKey string                   `json:"promptCacheKey,omitempty"`
}

func expandCanonicalAgentRequest(source *canonicalAgentRequest, config providerConfig, declarative bool) (*agentToolRequests, error) {
	if len(source.Messages) == 0 {
		return nil, errors.New("Canvas Agent request has no conversation content")
	}
	for _, message := range source.Messages {
		if stringField(message, "type") == "function_call" {
			callID, err := canonicalAgentFunctionCallID(message, "Canvas Agent tool call")
			if err != nil {
				return nil, err
			}
			if callID == "" || stringField(message, "name") == "" {
				return nil, errors.New("Canvas Agent tool call is missing an id or name")
			}
			message["call_id"] = callID
			if _, err := canonicalAgentFunctionCallItemID(message); err != nil {
				return nil, err
			}
			if _, ok := message["arguments"].(string); !ok {
				return nil, errors.New("Canvas Agent tool call arguments are invalid")
			}
			continue
		}
		if stringField(message, "type") != "" {
			return nil, errors.New("Canvas Agent conversation item type is invalid")
		}
		switch stringField(message, "role") {
		case "system", "user", "assistant":
		case "tool":
			if stringField(message, "tool_call_id") == "" {
				return nil, errors.New("Canvas Agent tool result is missing the call id")
			}
			if _, ok := message["content"].(string); !ok {
				return nil, errors.New("Canvas Agent tool result content is invalid")
			}
		default:
			return nil, errors.New("Canvas Agent conversation role is invalid")
		}
		if err := validateCanonicalAgentContent(message["content"]); err != nil {
			return nil, err
		}
	}
	for _, tool := range source.Tools {
		function, ok := tool["function"].(map[string]interface{})
		if !ok || stringField(function, "name") == "" {
			return nil, errors.New("Canvas Agent tool definition is missing a name")
		}
	}
	if err := validateCanonicalAgentHistory(source, config.InterfaceType == string(model.ChannelInterfaceOpenAIResponse)); err != nil {
		return nil, err
	}
	switch choice := source.ToolChoice.(type) {
	case string:
		if choice != "auto" && choice != "required" {
			return nil, errors.New("Canvas Agent tool choice is invalid")
		}
	case map[string]interface{}:
		if stringField(choice, "type") != "function" || stringField(choice, "name") == "" {
			return nil, errors.New("Canvas Agent tool choice is missing a name")
		}
	default:
		return nil, errors.New("Canvas Agent request is missing a tool choice")
	}
	messages := source.Messages
	if prompt := strings.TrimSpace(source.SystemPrompt); prompt != "" {
		present := false
		for _, message := range messages {
			if stringField(message, "role") == "system" && strings.TrimSpace(stringField(message, "content")) == prompt {
				present = true
				break
			}
		}
		if !present {
			messages = append([]map[string]interface{}{{"role": "system", "content": prompt}}, messages...)
		}
	}
	request := *source
	request.Messages = messages
	// 同名工具会被多数供应商直接拒绝（400）。按名称去重，保留第一次出现的定义。
	request.Tools = dedupeCanonicalAgentTools(source.Tools)
	result := &agentToolRequests{}
	if declarative {
		result.ChatCompletion = canonicalAgentChatBody(&request, false)
		responses, err := canonicalAgentResponsesBody(&request)
		if err != nil {
			return nil, err
		}
		result.Responses = responses
		result.Claude = claudeAgentBody(canonicalAgentChatBody(&request, true))
		result.Claude["model"] = config.Model
		result.Gemini = canonicalAgentGeminiBody(&request)
		return result, nil
	}
	switch config.InterfaceType {
	case string(model.ChannelInterfaceOpenAIResponse):
		responses, err := canonicalAgentResponsesBody(&request)
		if err != nil {
			return nil, err
		}
		result.Responses = responses
	case string(model.ChannelInterfaceClaudeAPI):
		result.Claude = claudeAgentBody(canonicalAgentChatBody(&request, true))
	default:
		result.ChatCompletion = canonicalAgentChatBody(&request, false)
	}
	return result, nil
}

func canonicalAgentChatBody(source *canonicalAgentRequest, claude bool) map[string]interface{} {
	messages := make([]interface{}, 0, len(source.Messages))
	format := "chat"
	if claude {
		format = "claude"
	}
	for index := 0; index < len(source.Messages); {
		message := source.Messages[index]
		if stringField(message, "type") == "function_call" {
			calls := []interface{}{}
			for index < len(source.Messages) && stringField(source.Messages[index], "type") == "function_call" {
				call := source.Messages[index]
				arguments := call["arguments"]
				if claude {
					arguments = canonicalAgentJSONObject(arguments)
				}
				calls = append(calls, map[string]interface{}{
					"id": call["call_id"], "type": "function",
					"function": map[string]interface{}{"name": call["name"], "arguments": arguments},
				})
				index++
			}
			messages = append(messages, map[string]interface{}{"role": "assistant", "content": nil, "tool_calls": calls})
			continue
		}
		converted := map[string]interface{}{"role": message["role"], "content": canonicalAgentContent(message["content"], format)}
		if calls := canonicalAgentToolCalls(message["tool_calls"]); len(calls) > 0 {
			// Runtime calls are protocol-neutral; materialize the wire discriminator here.
			wireCalls := make([]interface{}, 0, len(calls))
			for _, call := range calls {
				call["type"] = "function"
				wireCalls = append(wireCalls, call)
			}
			converted["tool_calls"] = wireCalls
		}
		if claude && stringField(message, "role") == "system" {
			converted["content"] = canonicalAgentText(message["content"])
		}
		if stringField(message, "role") == "tool" {
			converted["tool_call_id"] = message["tool_call_id"]
		}
		messages = append(messages, converted)
		index++
	}
	tools := make([]interface{}, 0, len(source.Tools))
	for _, tool := range source.Tools {
		tools = append(tools, tool)
	}
	choice := source.ToolChoice
	if named, ok := choice.(map[string]interface{}); ok {
		choice = map[string]interface{}{"type": "function", "function": map[string]interface{}{"name": named["name"]}}
	}
	body := map[string]interface{}{"messages": messages, "tools": tools, "tool_choice": choice, "parallel_tool_calls": false}
	if !claude && source.PromptCacheKey != "" {
		body["prompt_cache_key"] = source.PromptCacheKey
	}
	return body
}

func canonicalAgentResponsesBody(source *canonicalAgentRequest) (map[string]interface{}, error) {
	messages := make([]interface{}, 0, len(source.Messages))
	for _, message := range source.Messages {
		switch {
		case stringField(message, "type") == "function_call":
			callID, err := canonicalAgentFunctionCallID(message, "Canvas Agent tool call")
			if err != nil {
				return nil, err
			}
			if callID == "" {
				return nil, errors.New("Canvas Agent tool call is missing call_id")
			}
			itemID, err := canonicalAgentFunctionCallItemID(message)
			if err != nil {
				return nil, err
			}
			item := map[string]interface{}{
				"type": "function_call", "call_id": callID, "name": message["name"], "arguments": message["arguments"],
			}
			if itemID != "" {
				item["id"] = itemID
				item["item_reference"] = itemID
			}
			messages = append(messages, item)
		case stringField(message, "role") == "tool":
			callID, err := canonicalAgentStringAliases(message, "Canvas Agent tool result call_id", "tool_call_id", "toolCallId", "call_id")
			if err != nil {
				return nil, err
			}
			if callID == "" {
				return nil, errors.New("Canvas Agent tool result is missing tool_call_id")
			}
			messages = append(messages, map[string]interface{}{"type": "function_call_output", "call_id": callID, "output": message["content"]})
		default:
			messages = append(messages, map[string]interface{}{"role": message["role"], "content": canonicalAgentContent(message["content"], "responses")})
			for _, call := range canonicalAgentToolCalls(message["tool_calls"]) {
				function, _ := call["function"].(map[string]interface{})
				callID, err := canonicalAgentToolCallID(call, "Canvas Agent tool call")
				if err != nil {
					return nil, err
				}
				if callID == "" || stringField(function, "name") == "" {
					return nil, errors.New("Canvas Agent tool call is missing an id or name")
				}
				itemID, err := canonicalAgentToolCallItemID(call)
				if err != nil {
					return nil, err
				}
				item := map[string]interface{}{"type": "function_call", "call_id": callID, "name": function["name"], "arguments": function["arguments"]}
				if itemID != "" {
					item["id"] = itemID
					item["item_reference"] = itemID
				}
				messages = append(messages, item)
			}
		}
	}
	tools := make([]interface{}, 0, len(source.Tools))
	for _, tool := range source.Tools {
		function, _ := tool["function"].(map[string]interface{})
		converted := cloneStringAnyMap(function)
		converted["type"] = "function"
		tools = append(tools, converted)
	}
	body := map[string]interface{}{"input": messages, "tools": tools, "tool_choice": source.ToolChoice, "parallel_tool_calls": false}
	if source.PromptCacheKey != "" {
		body["prompt_cache_key"] = source.PromptCacheKey
	}
	return body, nil
}

func canonicalAgentStringAliases(fields map[string]interface{}, label string, aliases ...string) (string, error) {
	value := ""
	firstAlias := ""
	for _, alias := range aliases {
		raw, present := fields[alias]
		if !present || raw == nil {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			return "", fmt.Errorf("%s field %q must be a string", label, alias)
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if value != "" && value != text {
			return "", fmt.Errorf("%s alias %q conflicts with %q", label, firstAlias, alias)
		}
		if value == "" {
			value, firstAlias = text, alias
		}
	}
	return value, nil
}

func canonicalAgentFunctionCallID(fields map[string]interface{}, label string) (string, error) {
	return canonicalAgentStringAliases(fields, label+" call_id", "call_id", "toolCallId", "tool_call_id")
}

func canonicalAgentToolCallID(fields map[string]interface{}, label string) (string, error) {
	return canonicalAgentStringAliases(fields, label+" call_id", "id", "call_id", "toolCallId", "tool_call_id")
}

func canonicalAgentFunctionCallItemID(message map[string]interface{}) (string, error) {
	return canonicalAgentStringAliases(message, "Canvas Agent function_call item id", "item_id", "itemId", "id")
}

func canonicalAgentToolCallItemID(call map[string]interface{}) (string, error) {
	return canonicalAgentStringAliases(call, "Canvas Agent tool call item id", "item_id", "itemId")
}

func validateCanonicalAgentHistory(source *canonicalAgentRequest, requireResponseItemIDs bool) error {
	if source == nil {
		return errors.New("Canvas Agent conversation is empty")
	}
	pending := make(map[string]string)
	for _, message := range source.Messages {
		if stringField(message, "type") == "function_call" {
			callID, err := canonicalAgentFunctionCallID(message, "Canvas Agent tool call")
			if err != nil {
				return err
			}
			if callID == "" {
				return errors.New("Canvas Agent tool call is missing call_id")
			}
			if _, exists := pending[callID]; exists {
				return fmt.Errorf("Canvas Agent tool call %q is duplicated or has no result", callID)
			}
			itemID, err := canonicalAgentFunctionCallItemID(message)
			if err != nil {
				return err
			}
			pending[callID] = itemID
			continue
		}

		role := stringField(message, "role")
		switch role {
		case "assistant":
			calls := canonicalAgentToolCalls(message["tool_calls"])
			if len(calls) == 0 {
				if callID := firstPendingCanonicalAgentCall(pending); callID != "" {
					return fmt.Errorf("Canvas Agent tool call %q has no result", callID)
				}
				continue
			}
			if callID := firstPendingCanonicalAgentCall(pending); callID != "" {
				return fmt.Errorf("Canvas Agent tool call %q has no result", callID)
			}
			for _, call := range calls {
				callID, err := canonicalAgentToolCallID(call, "Canvas Agent tool call")
				if err != nil {
					return err
				}
				if callID == "" {
					return errors.New("Canvas Agent tool call is missing call_id")
				}
				if _, exists := pending[callID]; exists {
					return fmt.Errorf("Canvas Agent tool call %q is duplicated or has no result", callID)
				}
				itemID, err := canonicalAgentToolCallItemID(call)
				if err != nil {
					return err
				}
				pending[callID] = itemID
			}
		case "tool":
			callID, err := canonicalAgentStringAliases(message, "Canvas Agent tool result call_id", "tool_call_id", "toolCallId", "call_id")
			if err != nil {
				return err
			}
			if callID == "" {
				return errors.New("Canvas Agent tool result is missing tool_call_id")
			}
			itemID, exists := pending[callID]
			if !exists {
				return fmt.Errorf("Canvas Agent tool result %q has no matching tool call", callID)
			}
			if requireResponseItemIDs && itemID == "" {
				return fmt.Errorf("Canvas Agent Responses tool call %q is missing the function_call item id", callID)
			}
			delete(pending, callID)
		case "system", "user":
			if callID := firstPendingCanonicalAgentCall(pending); callID != "" {
				return fmt.Errorf("Canvas Agent tool call %q has no result", callID)
			}
		case "":
			return errors.New("Canvas Agent conversation item is missing a role")
		default:
			return fmt.Errorf("Canvas Agent conversation role is invalid: %s", role)
		}
	}
	if callID := firstPendingCanonicalAgentCall(pending); callID != "" {
		return fmt.Errorf("Canvas Agent tool call %q has no result", callID)
	}
	return nil
}

func firstPendingCanonicalAgentCall(pending map[string]string) string {
	for callID := range pending {
		return callID
	}
	return ""
}

func canonicalAgentGeminiBody(source *canonicalAgentRequest) map[string]interface{} {
	contents := make([]interface{}, 0, len(source.Messages))
	var system []string
	callNames := map[string]string{}
	for _, message := range source.Messages {
		role := "user"
		var parts interface{}
		switch {
		case stringField(message, "type") == "function_call":
			id, name := stringField(message, "call_id"), stringField(message, "name")
			callNames[id] = name
			part := map[string]interface{}{"functionCall": map[string]interface{}{"id": id, "name": name, "args": canonicalAgentJSONObject(message["arguments"])}}
			if signature := stringField(message, "thoughtSignature"); signature != "" {
				part["thoughtSignature"] = signature
			}
			role, parts = "model", []interface{}{part}
		case stringField(message, "role") == "system":
			if text := canonicalAgentText(message["content"]); text != "" {
				system = append(system, text)
			}
			continue
		case stringField(message, "role") == "tool":
			id := stringField(message, "tool_call_id")
			name := callNames[id]
			if name == "" {
				name = "tool_result"
			}
			parts = []interface{}{map[string]interface{}{"functionResponse": map[string]interface{}{
				"id": id, "name": name, "response": map[string]interface{}{"result": canonicalAgentJSONValue(message["content"])},
			}}}
		default:
			if stringField(message, "role") == "assistant" {
				role = "model"
			}
			parts = canonicalAgentContent(message["content"], "gemini")
		}
		contents = append(contents, map[string]interface{}{"role": role, "parts": parts})
	}
	body := map[string]interface{}{"contents": contents}
	if len(system) > 0 {
		body["systemInstruction"] = map[string]interface{}{"parts": []interface{}{map[string]interface{}{"text": strings.Join(system, "\n\n")}}}
	}
	if len(source.Tools) > 0 {
		declarations := make([]interface{}, 0, len(source.Tools))
		for _, tool := range source.Tools {
			function, _ := tool["function"].(map[string]interface{})
			declaration := cloneStringAnyMap(function)
			delete(declaration, "strict")
			declarations = append(declarations, declaration)
		}
		choice := map[string]interface{}{"mode": "AUTO"}
		if named, ok := source.ToolChoice.(map[string]interface{}); ok {
			choice["mode"], choice["allowedFunctionNames"] = "ANY", []interface{}{named["name"]}
		} else if source.ToolChoice == "required" {
			choice["mode"] = "ANY"
		}
		body["tools"] = []interface{}{map[string]interface{}{"functionDeclarations": declarations}}
		body["toolConfig"] = map[string]interface{}{"functionCallingConfig": choice}
	}
	return body
}

func canonicalAgentContent(content interface{}, format string) interface{} {
	items, array := content.([]interface{})
	if !array {
		if content == nil {
			content = ""
		}
		if format == "gemini" {
			return []interface{}{map[string]interface{}{"text": content}}
		}
		return content
	}
	result := make([]interface{}, 0, len(items))
	for _, value := range items {
		item, _ := value.(map[string]interface{})
		kind := stringField(item, "type")
		if kind == "text" {
			part := map[string]interface{}{"text": item["text"]}
			if format != "gemini" {
				part["type"] = "text"
				if format == "responses" {
					part["type"] = "input_text"
				}
			}
			result = append(result, part)
			continue
		}
		file, _ := item[kind].(map[string]interface{})
		url := stringField(file, "url")
		mimeType := stringField(file, "mimeType")
		if kind == "image_url" {
			mimeType = "image/png"
		}
		inlineMIME, inlineData, inline := canonicalAgentDataURL(url)
		var part map[string]interface{}
		switch format {
		case "responses":
			part = map[string]interface{}{"type": "input_image", "image_url": url}
			if kind == "file_url" {
				part = map[string]interface{}{"type": "input_file", "filename": file["name"]}
				if strings.HasPrefix(url, "data:") {
					part["file_data"] = url
				} else {
					part["file_url"] = url
				}
			}
		case "claude":
			if inline {
				blockType := "image"
				if kind == "file_url" && inlineMIME == "application/pdf" {
					blockType = "document"
				}
				part = map[string]interface{}{"type": blockType, "source": map[string]interface{}{"type": "base64", "media_type": inlineMIME, "data": inlineData}}
			} else if kind == "image_url" {
				part = map[string]interface{}{"type": "image", "source": map[string]interface{}{"type": "url", "url": url}}
			} else {
				part = map[string]interface{}{"type": "text", "text": stringField(file, "name") + ": " + url}
			}
		case "gemini":
			if inline {
				part = map[string]interface{}{"inlineData": map[string]interface{}{"mimeType": inlineMIME, "data": inlineData}}
			} else {
				part = map[string]interface{}{"fileData": map[string]interface{}{"fileUri": url, "mimeType": mimeType}}
			}
		default:
			part = item
			if kind == "file_url" {
				converted := map[string]interface{}{"filename": file["name"]}
				if strings.HasPrefix(url, "data:") {
					converted["file_data"] = url
				} else {
					converted["file_url"] = url
				}
				part = map[string]interface{}{"type": "file", "file": converted}
			}
		}
		result = append(result, part)
	}
	return result
}

func canonicalAgentDataURL(value string) (string, string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return "", "", false
	}
	mimeType, data, ok := strings.Cut(strings.TrimPrefix(value, "data:"), ";base64,")
	return mimeType, data, ok && mimeType != "" && data != ""
}

func validateCanonicalAgentContent(content interface{}) error {
	if _, ok := content.(string); ok {
		return nil
	}
	parts, ok := content.([]interface{})
	if !ok {
		return errors.New("Canvas Agent message content is invalid")
	}
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		switch kind := stringField(part, "type"); kind {
		case "text":
			if _, ok := part["text"].(string); !ok {
				return errors.New("Canvas Agent text content is invalid")
			}
		case "image_url", "file_url":
			file, _ := part[kind].(map[string]interface{})
			if stringField(file, "url") == "" {
				return errors.New("Canvas Agent media URL is empty")
			}
			if kind == "file_url" && (stringField(file, "name") == "" || stringField(file, "mimeType") == "") {
				return errors.New("Canvas Agent file is missing a name or type")
			}
		default:
			return errors.New("Canvas Agent message content type is invalid")
		}
	}
	return nil
}

func canonicalAgentJSONValue(value interface{}) interface{} {
	if raw, ok := value.(string); ok {
		var parsed interface{}
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			return parsed
		}
	}
	return value
}

func canonicalAgentToolCalls(value interface{}) []map[string]interface{} {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var calls []map[string]interface{}
	if json.Unmarshal(raw, &calls) != nil {
		return nil
	}
	return calls
}

func canonicalAgentJSONObject(value interface{}) map[string]interface{} {
	if parsed, ok := canonicalAgentJSONValue(value).(map[string]interface{}); ok {
		return parsed
	}
	return map[string]interface{}{}
}

func canonicalAgentText(content interface{}) string {
	if text, ok := content.(string); ok {
		return text
	}
	var texts []string
	if parts, ok := content.([]interface{}); ok {
		for _, value := range parts {
			part, _ := value.(map[string]interface{})
			if stringField(part, "type") == "text" {
				texts = append(texts, stringField(part, "text"))
			} else if image, ok := part["image_url"].(map[string]interface{}); ok {
				texts = append(texts, stringField(image, "url"))
			} else if file, ok := part["file_url"].(map[string]interface{}); ok {
				texts = append(texts, stringField(file, "name")+": "+stringField(file, "url"))
			}
		}
	}
	return strings.Join(texts, "\n")
}

func dedupeCanonicalAgentTools(tools []map[string]interface{}) []map[string]interface{} {
	seen := make(map[string]bool, len(tools))
	result := make([]map[string]interface{}, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]interface{})
		name := stringField(function, "name")
		if seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, tool)
	}
	return result
}
