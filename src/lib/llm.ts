export type LlmProvider = "anthropic" | "groq";

function normalize(input: string | undefined | null): string {
  return (input ?? "").trim().toLowerCase();
}

export function getLlmProvider(): LlmProvider {
  const forced = normalize(process.env.LLM_PROVIDER);
  if (forced === "groq") return "groq";
  if (forced === "anthropic") return "anthropic";

  // Auto-detect: prefer Groq when configured, otherwise fall back to Anthropic.
  if (process.env.GROQ_API_KEY) return "groq";
  return "anthropic";
}

