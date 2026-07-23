import { type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { type UserSettings } from "@/lib/settings-store";
import { resolveLlmConfig, LlmNotConfiguredError, type LlmConfig } from "@/lib/llm";
import { runWithContext } from "@/lib/request-context";

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

/**
 * Run `fn` with the authenticated user's GitHub token and LLM config
 * available via AsyncLocalStorage (no process.env mutation).
 *
 * The optional `requireLlm` flag (default true) controls whether
 * missing LLM settings should throw. Set to false for endpoints
 * that only need the GitHub token (PRs, repo-rules, etc.).
 */
export async function withSessionOverrides<T>(
    req: NextRequest,
    fn: (llmConfig: LlmConfig | null) => Promise<T>,
    options?: { requireLlm?: boolean },
): Promise<T> {
    const session = await getSession();
    if (!session) {
        throw new UnauthenticatedError();
    }

    const llmSettings = parseLlmSettingsHeader(req);
    const requireLlm = options?.requireLlm !== false;

    let llmConfig: LlmConfig | null = null;
    try {
        llmConfig = resolveLlmConfig(llmSettings);
    } catch (e) {
        if (requireLlm && e instanceof LlmNotConfiguredError) throw e;
    }

    // Provide a dummy config for non-LLM routes so the context is always valid
    const effectiveConfig = llmConfig ?? {
        provider: "anthropic" as const,
        model: "",
    };

    return runWithContext(
        { githubToken: session.token, llmConfig: effectiveConfig },
        () => fn(llmConfig),
    );
}

export { LlmNotConfiguredError };
