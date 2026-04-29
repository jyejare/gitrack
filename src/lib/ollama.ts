const DEFAULT_MODEL = "llama3";

type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

function getOllamaBaseUrl(): string {
    return (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
}

export async function callOllamaChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
}) {
    const baseUrl = getOllamaBaseUrl();

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            model: input.model,
            messages: [{ role: "user", content: input.prompt }],
            temperature: 0.2,
            max_tokens: input.maxTokens,
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to call Ollama (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as ChatCompletionsResponse;
    const content = json.choices?.[0]?.message?.content;
    return (content ?? "").trim();
}

export async function reviewPullWithOllama(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}) {
    const model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

    const truncated =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const userPrompt = [
        `You are a staff engineer doing a PR review.`,
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${input.title}`,
        ``,
        "Diff:",
        truncated,
        ``,
        "Return markdown with sections: Summary, Risks, Suggested follow-ups, Test gaps.",
        "Be concrete and reference files/lines when visible in the diff.",
    ].join("\n");

    const markdown = await callOllamaChatCompletions({
        model,
        prompt: userPrompt,
        maxTokens: 4096,
    });

    return { model, markdown };
}

export async function insightsPullWithOllama(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}) {
    const model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

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
        "Diff:",
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

    const markdown = await callOllamaChatCompletions({
        model,
        prompt: userPrompt,
        maxTokens: 1800,
    });

    return { model, markdown };
}
