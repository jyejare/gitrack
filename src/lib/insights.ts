import { callLlm, type LlmConfig } from "@/lib/llm";

export type InsightsResult = {
    model: string;
    markdown: string;
};

export async function insightsPull(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
    llmConfig: LlmConfig;
}): Promise<InsightsResult> {
    const truncated =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const prompt = [
        `You are a staff engineer helping reviewers triage a GitHub pull request.`,
        `Your job is NOT to write a full PR review. Instead, produce reviewer-focused insights that make it faster to decide what to look at and what risk to watch for.`,
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${input.title}`,
        ``,
        `Diff:`,
        truncated,
        ``,
        `Return markdown with these sections (short but specific):`,
        `1) "Reviewer checklist" (5-10 actionable checks)`,
        `2) "Risk hotspots" (call out potential failure modes, security/perf/maintainability concerns when visible)`,
        `3) "Testing suggestions" (what tests to run or add; include unit/integration/e2e if obvious)`,
        ``,
        `Constraints:`,
        `- If you cannot see enough context from the diff, say so.`,
        `- Be concrete: prefer file/area references when available.`,
    ].join("\n");

    const { model, text } = await callLlm(prompt, 1800, input.llmConfig);
    return { model, markdown: text };
}
