import { requireEnv } from "@/lib/env";

const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";

type MessageResponse = {
  content: Array<{ type: string; text?: string }>;
};

export async function reviewPullWithClaude(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  diff: string;
  maxDiffChars: number;
}) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const truncated =
    input.diff.length > input.maxDiffChars
      ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
      : input.diff;

  const userPrompt = [
    `You are a staff engineer doing a PR review.`,
    `Repository: ${input.owner}/${input.repo}`,
    `PR #${input.number}: ${input.title}`,
    "",
    "Diff:",
    truncated,
    "",
    "Return markdown with sections: Summary, Risks, Suggested follow-ups, Test gaps.",
    "Be concrete and reference files/lines when visible in the diff.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: userPrompt }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 800)}`);
  }

  const json = (await res.json()) as MessageResponse;
  const text = json.content
    .map((b) => (b.type === "text" && b.text ? b.text : ""))
    .join("")
    .trim();

  return { model, markdown: text };
}

export async function insightsPullWithClaude(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  diff: string;
  maxDiffChars: number;
}) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const truncated =
    input.diff.length > input.maxDiffChars
      ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
      : input.diff;

  const userPrompt = [
    `You are a staff engineer helping reviewers triage a GitHub pull request.`,
    `Your job is NOT to write a full PR review. Instead, produce reviewer-focused insights that make it faster to decide what to look at and what risk to watch for.`,
    `Repository: ${input.owner}/${input.repo}`,
    `PR #${input.number}: ${input.title}`,
    ``,
    `Diff:`,
    truncated,
    ``,
    `Return markdown with these sections (short but specific):`,
    `1) "At a glance" (3-5 bullets describing the most important changes)`,
    `2) "Reviewer checklist" (5-10 actionable checks)`,
    `3) "Risk hotspots" (call out potential failure modes, security/perf/maintainability concerns when visible)`,
    `4) "Testing suggestions" (what tests to run or add; include unit/integration/e2e if obvious)`,
    ``,
    `Constraints:`,
    `- If you cannot see enough context from the diff, say so.`,
    `- Be concrete: prefer file/area references when available.`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      messages: [{ role: "user", content: userPrompt }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 800)}`);
  }

  const json = (await res.json()) as MessageResponse;
  const text = json.content
    .map((b) => (b.type === "text" && b.text ? b.text : ""))
    .join("")
    .trim();

  return { model, markdown: text };
}
