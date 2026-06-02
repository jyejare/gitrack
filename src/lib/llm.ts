import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { callAnthropicMessages } from "@/lib/anthropic";
import { callGroqChatCompletions } from "@/lib/groq";
import { callOllamaChatCompletions } from "@/lib/ollama";
import { callVertexAnthropicMessages } from "@/lib/vertex";
import type { UserSettings } from "@/lib/settings-store";

export type LlmProvider = "anthropic" | "groq" | "ollama" | "vertex";

const PROVIDER_DEFAULTS: Record<LlmProvider, { envModel: string; defaultModel: string }> = {
  anthropic: { envModel: "ANTHROPIC_MODEL", defaultModel: "claude-3-5-sonnet-20241022" },
  groq: { envModel: "GROQ_MODEL", defaultModel: "llama3-70b-8192" },
  ollama: { envModel: "OLLAMA_MODEL", defaultModel: "llama3" },
  vertex: { envModel: "VERTEX_MODEL", defaultModel: "claude-sonnet-4@20250514" },
};

const CALL_FNS: Record<LlmProvider, (i: { model: string; prompt: string; maxTokens: number }) => Promise<string>> = {
  anthropic: callAnthropicMessages,
  groq: callGroqChatCompletions,
  ollama: callOllamaChatCompletions,
  vertex: callVertexAnthropicMessages,
};

function normalize(input: string | undefined | null): string {
  return (input ?? "").trim().toLowerCase();
}

export function getLlmProvider(overrides?: UserSettings | null): LlmProvider {
  const forced = normalize(overrides?.llm_provider ?? process.env.LLM_PROVIDER);
  if (forced === "groq") return "groq";
  if (forced === "anthropic") return "anthropic";
  if (forced === "ollama") return "ollama";
  if (forced === "vertex") return "vertex";

  if (overrides?.ollama_host || process.env.OLLAMA_HOST) return "ollama";
  if (overrides?.vertex_project_id || process.env.VERTEX_PROJECT_ID) return "vertex";
  if (overrides?.groq_api_key || process.env.GROQ_API_KEY) return "groq";
  return "anthropic";
}

/**
 * Apply user settings as env var overrides for the current request.
 * Returns a cleanup function to restore originals.
 */
const SA_KEY_DIR = join(process.cwd(), ".data", "sa-keys");

export function applySettingsOverrides(settings: UserSettings | null | undefined): () => void {
  if (!settings) return () => {};
  const envMap: Record<string, string | undefined> = {
    GITHUB_TOKEN: settings.github_token,
    LLM_PROVIDER: settings.llm_provider,
    ANTHROPIC_API_KEY: settings.anthropic_api_key,
    ANTHROPIC_MODEL: settings.anthropic_model,
    GROQ_API_KEY: settings.groq_api_key,
    GROQ_MODEL: settings.groq_model,
    OLLAMA_HOST: settings.ollama_host,
    OLLAMA_MODEL: settings.ollama_model,
    VERTEX_PROJECT_ID: settings.vertex_project_id,
    VERTEX_REGION: settings.vertex_region,
    VERTEX_MODEL: settings.vertex_model,
  };

  // Write SA key JSON to a temp file so Google client libraries can use it
  let saKeyPath: string | null = null;
  if (settings.vertex_sa_key) {
    try {
      mkdirSync(SA_KEY_DIR, { recursive: true });
      saKeyPath = join(SA_KEY_DIR, `sa-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(saKeyPath, settings.vertex_sa_key, { mode: 0o600 });
      envMap.GOOGLE_APPLICATION_CREDENTIALS = saKeyPath;
    } catch {
      saKeyPath = null;
    }
  }

  const originals: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(envMap)) {
    if (val) {
      originals[key] = process.env[key];
      process.env[key] = val;
    }
  }

  return () => {
    for (const [key, orig] of Object.entries(originals)) {
      if (orig === undefined) delete process.env[key];
      else process.env[key] = orig;
    }
    if (saKeyPath) {
      try { unlinkSync(saKeyPath); } catch { /* already cleaned */ }
    }
  };
}

export async function callLlm(prompt: string, maxTokens: number, overrides?: UserSettings | null): Promise<{ model: string; text: string }> {
  const provider = getLlmProvider(overrides);
  const { envModel, defaultModel } = PROVIDER_DEFAULTS[provider];
  const model = process.env[envModel] ?? defaultModel;
  const text = await CALL_FNS[provider]({ model, prompt, maxTokens });
  return { model, text };
}

