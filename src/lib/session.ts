import { type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getSettings, type UserSettings } from "@/lib/settings-store";
import { applySettingsOverrides } from "@/lib/llm";

export async function withSessionOverrides<T>(
    req: NextRequest,
    fn: () => Promise<T>,
): Promise<T> {
    const session = await getSession();
    const userId = session?.user.login;

    let settings: UserSettings | null = null;
    if (userId) {
        settings = await getSettings(userId);
    }

    // Use the PAT from the session cookie for GitHub API calls
    if (session?.token && !settings?.github_token) {
        settings = { ...settings, github_token: session.token };
    }

    const restore = applySettingsOverrides(settings);
    try {
        return await fn();
    } finally {
        restore();
    }
}
