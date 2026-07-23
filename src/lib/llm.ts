import { callAnthropicMessages } from "@/lib/anthropic";
import { callGroqChatCompletions } from "@/lib/groq";
import { callOllamaChatCompletions } from "@/lib/ollama";
import { callVertexAnthropicMessages } from "@/lib/vertex";
import { callVllmChatCompletions } from "@/lib/vllm";
import type { UserSettings } from "@/lib/settings-store";

export type LlmProvider = "anthropic" | "groq" | "ollama" | "vertex" | "vllm";

/** Resolved credentials for a single LLM call — no process.env reads at runtime. */
export type LlmConfig = {
    provider: LlmProvider;
    model: string;
    anthropic_api_key?: string;
    groq_api_key?: string;
    ollama_host?: string;
    vertex_project_id?: string;
    vertex_region?: string;
    vertex_sa_key?: string;
    vllm_host?: string;
    vllm_api_key?: string;
};

/** All request-scoped context needed by API handlers. */
export type RequestContext = {
    githubToken: string;
    llmConfig: LlmConfig;
};

const PROVIDER_DEFAULTS: Record<LlmProvider, { settingsModel: keyof UserSettings; defaultModel: string }> = {
    anthropic: { settingsModel: "anthropic_model", defaultModel: "claude-3-5-sonnet-20241022" },
    groq: { settingsModel: "groq_model", defaultModel: "llama3-70b-8192" },
    ollama: { settingsModel: "ollama_model", defaultModel: "llama3" },
    vertex: { settingsModel: "vertex_model", defaultModel: "claude-sonnet-4@20250514" },
    vllm: { settingsModel: "vllm_model", defaultModel: "auto" },
};

function normalize(input: string | undefined | null): string {
    return (input ?? "").trim().toLowerCase();
}

export class LlmNotConfiguredError extends Error {
    constructor() {
        super("No LLM provider configured. Go to Settings and configure an LLM provider with credentials.");
        this.name = "LlmNotConfiguredError";
    }
}

export function resolveLlmConfig(settings: UserSettings | null | undefined): LlmConfig {
    if (!settings) throw new LlmNotConfiguredError();

    const provider = resolveProvider(settings);
    const { settingsModel, defaultModel } = PROVIDER_DEFAULTS[provider];
    const model = (settings[settingsModel] as string | undefined)?.trim() || defaultModel;

    return {
        provider,
        model,
        anthropic_api_key: settings.anthropic_api_key,
        groq_api_key: settings.groq_api_key,
        ollama_host: settings.ollama_host,
        vertex_project_id: settings.vertex_project_id,
        vertex_region: settings.vertex_region,
        vertex_sa_key: settings.vertex_sa_key,
        vllm_host: settings.vllm_host,
        vllm_api_key: settings.vllm_api_key,
    };
}

function resolveProvider(settings: UserSettings): LlmProvider {
    const forced = normalize(settings.llm_provider);
    if (forced === "groq") return "groq";
    if (forced === "anthropic") return "anthropic";
    if (forced === "ollama") return "ollama";
    if (forced === "vertex") return "vertex";
    if (forced === "vllm") return "vllm";

    // Auto-detect from filled-in credentials
    if (settings.vllm_host) return "vllm";
    if (settings.ollama_host) return "ollama";
    if (settings.vertex_project_id) return "vertex";
    if (settings.groq_api_key) return "groq";
    if (settings.anthropic_api_key) return "anthropic";

    throw new LlmNotConfiguredError();
}

function validateConfig(config: LlmConfig): void {
    switch (config.provider) {
        case "anthropic":
            if (!config.anthropic_api_key) throw new LlmNotConfiguredError();
            break;
        case "groq":
            if (!config.groq_api_key) throw new LlmNotConfiguredError();
            break;
        case "vertex":
            if (!config.vertex_project_id || !config.vertex_sa_key)
                throw new LlmNotConfiguredError();
            break;
        case "ollama":
            if (!config.ollama_host) throw new LlmNotConfiguredError();
            break;
        case "vllm":
            if (!config.vllm_host) throw new LlmNotConfiguredError();
            break;
    }
}

export async function callLlm(
    prompt: string,
    maxTokens: number,
    config: LlmConfig,
): Promise<{ model: string; text: string }> {
    validateConfig(config);

    const input = { model: config.model, prompt, maxTokens };
    let text: string;

    switch (config.provider) {
        case "anthropic":
            text = await callAnthropicMessages({ ...input, apiKey: config.anthropic_api_key! });
            break;
        case "groq":
            text = await callGroqChatCompletions({ ...input, apiKey: config.groq_api_key! });
            break;
        case "ollama":
            text = await callOllamaChatCompletions({ ...input, host: config.ollama_host! });
            break;
        case "vertex":
            text = await callVertexAnthropicMessages({
                ...input,
                projectId: config.vertex_project_id!,
                region: config.vertex_region,
                saKeyJson: config.vertex_sa_key!,
            });
            break;
        case "vllm":
            text = await callVllmChatCompletions({
                ...input,
                host: config.vllm_host!,
                apiKey: config.vllm_api_key,
            });
            break;
    }

    return { model: config.model, text };
}
