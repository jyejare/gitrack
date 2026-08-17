import { GoogleAuth } from "google-auth-library";

type MessageResponse = {
    content: Array<{ type: string; text?: string }>;
};

async function getAccessToken(saKeyJson: string): Promise<string> {
    let credentials: Record<string, unknown>;
    try {
        credentials = JSON.parse(saKeyJson) as Record<string, unknown>;
    } catch {
        throw new Error("Failed to parse Vertex SA key — must be valid JSON");
    }

    // Pasted keys sometimes store line breaks as "\\n". OpenSSL needs actual line breaks.
    if (typeof credentials.private_key === "string") {
        credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }

    const auth = new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

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
    projectId: string;
    region?: string;
    saKeyJson: string;
}): Promise<string> {
    const region = input.region?.trim() || "us-east5";
    const accessToken = await getAccessToken(input.saKeyJson);
    const host =
        region.toLowerCase() === "global"
            ? "aiplatform.googleapis.com"
            : `${region}-aiplatform.googleapis.com`;

    const url =
        `https://${host}/v1/projects/${input.projectId}` +
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
