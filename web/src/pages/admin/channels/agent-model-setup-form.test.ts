import assert from "node:assert/strict";
import test from "node:test";

import { agentModelProtocolOptions, agentModelSetupPayload } from "./agent-model-setup-form";

test("agent model payload trims fields and leaves an empty key out so the saved key stays", () => {
    const payload = agentModelSetupPayload({ protocol: "claude-api", baseUrl: " https://api.anthropic.com ", apiKey: "   ", model: " claude-test ", vision: true });
    assert.deepEqual(payload, { protocol: "claude-api", baseUrl: "https://api.anthropic.com", apiKey: undefined, model: "claude-test", vision: true, contextWindowTokens: undefined, maxOutputTokens: undefined });
});

test("agent model protocols match the text protocols the backend accepts", () => {
    assert.deepEqual(
        agentModelProtocolOptions.map((option) => option.value),
        ["chat-completion", "openai-response", "claude-api"],
    );
});
