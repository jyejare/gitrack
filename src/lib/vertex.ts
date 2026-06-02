import { requireEnv } from "@/lib/env";
import { GoogleAuth } from "google-auth-library";

const DEFAULT_MODEL = "claude-sonnet-4@20250514";

type MessageResponse = {
    content: Array<{ type: string; text?: string }>;
};

let cachedAuth: { key: string; client: GoogleAuth } | null = null;

function getAuthClient(): GoogleAuth {
    const saKeyRaw = process.env.VERTEX_SA_KEY ?? "";
    const cacheKey = saKeyRaw || "__adc__";

    if (cachedAuth && cachedAuth.key === cacheKey) return cachedAuth.client;

    const opts: ConstructorParameters<typeof GoogleAuth>[0] = {
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    };

    if (saKeyRaw) {
        try {
            opts.credentials = JSON.parse(saKeyRaw);
        } catch {
            throw new Error("Failed to parse VERTEX_SA_KEY – must be valid JSON");
        }
    }

    const client = new GoogleAuth(opts);
    cachedAuth = { key: cacheKey, client };
    return client;
}

async function getAccessToken(): Promise<string> {
    const auth = getAuthClient();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
    if (!token) {
        throw new Error("Failed to obtain Google Cloud access token");
    }
    return token;
}

export async function callVertexAnthropicMessages(input: {
    model: string;
    prompt: string;
    maxTokens: number;
}): Promise<string> {
    const projectId = requireEnv("VERTEX_PROJECT_ID");
    const region = process.env.VERTEX_REGION ?? "us-east5";

    const accessToken = await getAccessToken();
    const url =
        `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}` +
        `/locations/${region}/publishers/anthropic/models/${input.model}:rawPredict`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            anthropic_version: "vertex-2023-10-16",
            messages: [{ role: "user", content: input.prompt }],
            max_tokens: input.maxTokens,
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to call Vertex AI (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as MessageResponse;
    return json.content
        .map((b) => (b.type === "text" && b.text ? b.text : ""))
        .join("")
        .trim();
}

export async function reviewPullWithVertex(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}) {
    const model = process.env.VERTEX_MODEL ?? DEFAULT_MODEL;

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

    const markdown = await callVertexAnthropicMessages({
        model,
        prompt: userPrompt,
        maxTokens: 4096,
    });

    return { model, markdown };
}

export async function insightsPullWithVertex(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}) {
    const model = process.env.VERTEX_MODEL ?? DEFAULT_MODEL;

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

    const markdown = await callVertexAnthropicMessages({
        model,
        prompt: userPrompt,
        maxTokens: 1800,
    });

    return { model, markdown };
}
