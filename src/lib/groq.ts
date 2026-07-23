type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

export async function callGroqChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
    apiKey: string;
}): Promise<string> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
        },
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
        throw new Error(`Failed to call Groq (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as ChatCompletionsResponse;
    const content = json.choices?.[0]?.message?.content;
    return (content ?? "").trim();
}
