type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

export async function callOllamaChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
    host: string;
}): Promise<string> {
    const baseUrl = input.host.replace(/\/+$/, "");

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
