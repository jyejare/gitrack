import { callAnthropicMessages } from "@/lib/anthropic";
import { callGroqChatCompletions } from "@/lib/groq";
import { callOllamaChatCompletions } from "@/lib/ollama";
import { callVertexAnthropicMessages } from "@/lib/vertex";

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

export function getLlmProvider(): LlmProvider {
  const forced = normalize(process.env.LLM_PROVIDER);
  if (forced === "groq") return "groq";
  if (forced === "anthropic") return "anthropic";
  if (forced === "ollama") return "ollama";
  if (forced === "vertex") return "vertex";

  // Auto-detect: Ollama if host configured, Vertex if project set, Groq if key present, else Anthropic.
  if (process.env.OLLAMA_HOST) return "ollama";
  if (process.env.VERTEX_PROJECT_ID) return "vertex";
  if (process.env.GROQ_API_KEY) return "groq";
  return "anthropic";
}

export async function callLlm(prompt: string, maxTokens: number): Promise<{ model: string; text: string }> {
  const provider = getLlmProvider();
  const { envModel, defaultModel } = PROVIDER_DEFAULTS[provider];
  const model = process.env[envModel] ?? defaultModel;
  const text = await CALL_FNS[provider]({ model, prompt, maxTokens });
  return { model, text };
}

