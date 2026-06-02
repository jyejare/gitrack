import { type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getSettings, type UserSettings } from "@/lib/settings-store";
import { applySettingsOverrides } from "@/lib/llm";

export class UnauthenticatedError extends Error {
    constructor() {
        super("Authentication required");
        this.name = "UnauthenticatedError";
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

    const userId = session.user.login;

    let settings: UserSettings | null = null;
    if (userId) {
        settings = await getSettings(userId);
    }

    if (!settings?.github_token) {
        settings = { ...settings, github_token: session.token };
    }

    const restore = applySettingsOverrides(settings);
    try {
        return await fn();
    } finally {
        restore();
    }
}
