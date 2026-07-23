type MessageResponse = {
    content: Array<{ type: string; text?: string }>;
};

export async function callAnthropicMessages(input: {
    model: string;
    prompt: string;
    maxTokens: number;
    apiKey: string;
}): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": input.apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: input.model,
            max_tokens: input.maxTokens,
            messages: [{ role: "user", content: input.prompt }],
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to call Anthropic (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as MessageResponse;
    return json.content
        .map((b) => (b.type === "text" && b.text ? b.text : ""))
        .join("")
        .trim();
}
