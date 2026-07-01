type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

function getVllmBaseUrl(): string {
    return (process.env.VLLM_HOST ?? "http://localhost:8000").replace(/\/+$/, "");
}

export async function callVllmChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
}) {
    const baseUrl = getVllmBaseUrl();
    const apiKey = process.env.VLLM_API_KEY;

    const headers: Record<string, string> = {
        "content-type": "application/json",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
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
        throw new Error(`Failed to call vLLM (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as ChatCompletionsResponse;
    const content = json.choices?.[0]?.message?.content;
    return (content ?? "").trim();
}
