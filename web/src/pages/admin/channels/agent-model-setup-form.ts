import type { AgentModelProtocol, AgentModelSetupInput } from "@/services/api/agent-model-setup";

export type AgentModelFormValues = {
    protocol: AgentModelProtocol;
    baseUrl: string;
    apiKey?: string;
    model: string;
    vision: boolean;
    contextWindowTokens?: number;
    maxOutputTokens?: number;
};

export const agentModelProtocolOptions: { label: string; value: AgentModelProtocol; baseUrl: string }[] = [
    { label: "OpenAI Chat Completions (also OpenRouter, DeepSeek, Ollama, vLLM)", value: "chat-completion", baseUrl: "https://api.openai.com/v1" },
    { label: "OpenAI Responses", value: "openai-response", baseUrl: "https://api.openai.com/v1" },
    { label: "Anthropic Messages", value: "claude-api", baseUrl: "https://api.anthropic.com" },
];

export function agentModelSetupPayload(values: AgentModelFormValues): AgentModelSetupInput {
    return {
        protocol: values.protocol,
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey?.trim() || undefined,
        model: values.model.trim(),
        vision: Boolean(values.vision),
        contextWindowTokens: values.contextWindowTokens || undefined,
        maxOutputTokens: values.maxOutputTokens || undefined,
    };
}
