type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

type ModelsResponse = {
    data?: Array<{ id: string }>;
};

async function resolveModel(configured: string, host: string, apiKey?: string): Promise<string> {
    if (configured && configured !== "default" && configured !== "auto") {
        return configured;
    }

    const baseUrl = host.replace(/\/+$/, "");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
        const res = await fetch(`${baseUrl}/v1/models`, {
            headers,
            cache: "no-store",
        });
        if (res.ok) {
            const json = (await res.json()) as ModelsResponse;
            const first = json.data?.[0]?.id;
            if (first) return first;
        }
    } catch { /* fall through */ }
    throw new Error("Failed to detect vLLM model — set VLLM_MODEL or configure it in Settings");
}

export async function callVllmChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
    host: string;
    apiKey?: string;
}): Promise<string> {
    const baseUrl = input.host.replace(/\/+$/, "");
    const model = await resolveModel(input.model, input.host, input.apiKey);

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
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
