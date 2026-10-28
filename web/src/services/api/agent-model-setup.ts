import { http } from "@/services/api/request";

export type AgentModelProtocol = "chat-completion" | "openai-response" | "claude-api";

export type AgentModelSetup = {
    configured: boolean;
    channelId?: string;
    modelId?: string;
    protocol: AgentModelProtocol;
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    vision: boolean;
    contextWindowTokens: number;
    maxOutputTokens: number;
    enabled: boolean;
};

export type AgentModelSetupInput = {
    protocol: AgentModelProtocol;
    baseUrl: string;
    /** Empty keeps the stored key. */
    apiKey?: string;
    model: string;
    vision: boolean;
    contextWindowTokens?: number;
    maxOutputTokens?: number;
};

export function getAgentModelSetup() {
    return http.get<{ setup: AgentModelSetup }>("/admin/agent-model");
}

export function saveAgentModelSetup(input: AgentModelSetupInput) {
    return http.put<{ setup: AgentModelSetup }>("/admin/agent-model", input);
}
