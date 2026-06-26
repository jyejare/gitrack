import { type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { type UserSettings } from "@/lib/settings-store";
import { applySettingsOverrides } from "@/lib/llm";

export class UnauthenticatedError extends Error {
    constructor() {
        super("Authentication required");
        this.name = "UnauthenticatedError";
    }
}

function parseLlmSettingsHeader(req: NextRequest): UserSettings | null {
    const header = req.headers.get("X-LLM-Settings");
    if (!header) return null;
    try {
        const json = decodeURIComponent(escape(atob(header)));
        return JSON.parse(json) as UserSettings;
    } catch {
        return null;
    }
}

export async function withSessionOverrides<T>(
    req: NextRequest,
    fn: () => Promise<T>,
): Promise<T> {
    const session = await getSession();
    if (!session) {
        throw new UnauthenticatedError();
    }

    // LLM settings come from client-side localStorage via request header;
    // GitHub token always comes from the server-side session cookie.
    const llmSettings = parseLlmSettingsHeader(req);
    const settings: UserSettings = {
        ...llmSettings,
        github_token: session.token,
    };

    const restore = applySettingsOverrides(settings);
    try {
        return await fn();
    } finally {
        restore();
    }
}
