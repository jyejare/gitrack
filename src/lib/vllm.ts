type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

type ModelsResponse = {
    data?: Array<{ id: string }>;
};

function getVllmBaseUrl(): string {
    return (process.env.VLLM_HOST ?? "http://localhost:8000").replace(/\/+$/, "");
}

function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const apiKey = process.env.VLLM_API_KEY;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

let cachedModelId: string | null = null;

async function resolveModel(configured: string): Promise<string> {
    if (configured && configured !== "default" && configured !== "auto") {
        return configured;
    }
    if (cachedModelId) return cachedModelId;

    const baseUrl = getVllmBaseUrl();
    try {
        const res = await fetch(`${baseUrl}/v1/models`, {
            headers: getAuthHeaders(),
            cache: "no-store",
        });
        if (res.ok) {
            const json = (await res.json()) as ModelsResponse;
            const first = json.data?.[0]?.id;
            if (first) {
                cachedModelId = first;
                return first;
            }
        }
    } catch { /* fall through */ }
    throw new Error("Failed to detect vLLM model — set VLLM_MODEL or configure it in Settings");
}

export async function callVllmChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
}) {
    const baseUrl = getVllmBaseUrl();
    const model = await resolveModel(input.model);

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: input.prompt }],
            temperature: 0.2,
            max_tokens: input.maxTokens,
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to call vLLM (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as ChatCompletionsResponse;
    const content = json.choices?.[0]?.message?.content;
    return (content ?? "").trim();
}
