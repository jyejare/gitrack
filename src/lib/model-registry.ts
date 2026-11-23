import type { UserSettings } from "@/lib/settings-store";

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  description?: string;
}

const BUILTIN_MODELS: ModelInfo[] = [
  { id: "claude-3-5-sonnet-20241022", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 8192, supportsVision: true, supportsTools: true },
  { id: "claude-3-5-haiku-20241022", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 8192, supportsVision: true, supportsTools: true },
  { id: "claude-3-opus-20240229", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 4096, supportsVision: true, supportsTools: true },
  { id: "claude-sonnet-4@20250514", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 8192, supportsVision: true, supportsTools: true },
  { id: "gpt-5.6-luna", provider: "openai", contextWindow: 128_000, maxOutputTokens: 16384, supportsVision: true, supportsTools: true },
  { id: "gpt-4o", provider: "openai", contextWindow: 128_000, maxOutputTokens: 16384, supportsVision: true, supportsTools: true },
  { id: "gpt-4o-mini", provider: "openai", contextWindow: 128_000, maxOutputTokens: 16384, supportsVision: true, supportsTools: true },
  { id: "gpt-4-turbo", provider: "openai", contextWindow: 128_000, maxOutputTokens: 4096, supportsVision: true, supportsTools: true },
  { id: "gpt-4", provider: "openai", contextWindow: 8_192, maxOutputTokens: 4096, supportsVision: false, supportsTools: true },
  { id: "llama3-70b-8192", provider: "groq", contextWindow: 8_192, maxOutputTokens: 8192, supportsVision: false, supportsTools: true },
  { id: "llama3-8b-8192", provider: "groq", contextWindow: 8_192, maxOutputTokens: 8192, supportsVision: false, supportsTools: true },
  { id: "mixtral-8x7b-32768", provider: "groq", contextWindow: 32_768, maxOutputTokens: 8192, supportsVision: false, supportsTools: true },
  { id: "gemma2-9b-it", provider: "groq", contextWindow: 8_192, maxOutputTokens: 8192, supportsVision: false, supportsTools: true },
  { id: "llama3", provider: "ollama", contextWindow: 8_192, maxOutputTokens: 2048, supportsVision: false, supportsTools: false },
  { id: "auto", provider: "vllm", contextWindow: 4_096, maxOutputTokens: 2048, supportsVision: false, supportsTools: false },
];

const PROVIDER_DEFAULTS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  groq: 8_192,
  ollama: 4_096,
  vertex: 200_000,
  vllm: 4_096,
};

let customModels: ModelInfo[] = [];

export function registerCustomModels(models: ModelInfo[]): void {
  customModels = models;
}

export function getModelInfo(modelId: string, provider: string): ModelInfo {
  const normalized = modelId.toLowerCase();

  for (const m of [...customModels, ...BUILTIN_MODELS]) {
    if (m.id.toLowerCase() === normalized && m.provider === provider) {
      return m;
    }
  }

  for (const m of [...customModels, ...BUILTIN_MODELS]) {
    if (normalized.includes(m.id.toLowerCase().split("@")[0]) && m.provider === provider) {
      return m;
    }
  }

  return {
    id: modelId,
    provider,
    contextWindow: PROVIDER_DEFAULTS[provider] ?? 4_096,
    maxOutputTokens: 2048,
    supportsVision: false,
    supportsTools: false,
    description: "Auto-detected from provider default",
  };
}

export function getModelContextWindow(modelId: string, provider: string): number {
  return getModelInfo(modelId, provider).contextWindow;
}

export function getModelMaxOutputTokens(modelId: string, provider: string): number {
  return getModelInfo(modelId, provider).maxOutputTokens ?? 2048;
}

export function resolveModelFromSettings(settings: UserSettings | null | undefined): { provider: string; model: string } | null {
  if (!settings) return null;

  const provider = settings.llm_provider?.toLowerCase();
  if (!provider) return null;

  const modelKey = `${provider}_model` as keyof UserSettings;
  const model = settings[modelKey] as string | undefined;

  if (model) return { provider, model };

  const fallbackKey = `${provider}_api_key` as keyof UserSettings;
  if (settings[fallbackKey]) {
    const defaultModel = BUILTIN_MODELS.find((m) => m.provider === provider)?.id;
    if (defaultModel) return { provider, model: defaultModel };
  }

  return null;
}

export function getEffectiveModelConfig(settings: UserSettings | null | undefined): { provider: string; model: string; contextWindow: number; maxOutputTokens: number } | null {
  const resolved = resolveModelFromSettings(settings);
  if (!resolved) return null;

  const info = getModelInfo(resolved.model, resolved.provider);
  return {
    provider: resolved.provider,
    model: resolved.model,
    contextWindow: info.contextWindow,
    maxOutputTokens: info.maxOutputTokens ?? 2048,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars) + "\n\n[TRUNCATED]";
}

export function sanitizeForPrompt(input: string): string {
  // Strip XML-tag-like patterns that could close our prompt delimiters
  // (e.g. a user injecting "</diff>" or "</conversation-history>")
  // but preserve normal angle brackets in code/text.
  return input
    .replace(/<\/(diff|pr-description|discussion-comments|ci-checks|glance-summary|review-guide|repo-rules|conversation-history)>/gi, "[$1-end]")
    .trim();
}

export function sanitizePromptSections(sections: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) {
    out[key] = sanitizeForPrompt(value);
  }
  return out;
}

export interface TokenBudget {
  total: number;
  reservedForOutput: number;
  availableForContext: number;
}

export function calculateTokenBudget(
  modelId: string,
  provider: string,
  requestedMaxTokens: number,
): TokenBudget {
  const contextWindow = getModelContextWindow(modelId, provider);
  const modelMaxOutput = getModelMaxOutputTokens(modelId, provider);
  const reservedForOutput = Math.min(requestedMaxTokens, modelMaxOutput, Math.floor(contextWindow * 0.15));
  const availableForContext = contextWindow - reservedForOutput - 1_000;
  return {
    total: contextWindow,
    reservedForOutput,
    availableForContext: Math.max(availableForContext, 1_000),
  };
}