import { AsyncLocalStorage } from "node:async_hooks";
import type { LlmConfig } from "@/lib/llm";

export type RequestContext = {
    githubToken: string;
    llmConfig: LlmConfig;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given request context available to all called code. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
}

export function getContext(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) throw new Error("Failed to access request context — not inside a request handler");
    return ctx;
}

export function getGithubToken(): string {
    return getContext().githubToken;
}

export function getLlmConfig(): LlmConfig {
    return getContext().llmConfig;
}
