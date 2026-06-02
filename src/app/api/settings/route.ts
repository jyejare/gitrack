import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSettings, saveSettings, deleteSettings, maskKey, type UserSettings } from "@/lib/settings-store";

export const runtime = "nodejs";

async function getUserId(): Promise<string | null> {
    const session = await getSession();
    return session?.user.login ?? null;
}

export async function GET(req: NextRequest) {
    const userId = await getUserId();
    if (!userId) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const settings = await getSettings(userId);
    if (!settings) {
        return NextResponse.json({ settings: null });
    }

    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings)) {
        masked[k] = k.includes("key") || k.includes("token") ? maskKey(v) : (v ?? "");
    }
    return NextResponse.json({ settings: masked });
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const body = (await req.json()) as { settings?: UserSettings };
        if (!body.settings || typeof body.settings !== "object") {
            return NextResponse.json({ error: "settings object is required" }, { status: 400 });
        }

        const existing = await getSettings(userId);
        const merged: UserSettings = { ...existing };

        const allowed: (keyof UserSettings)[] = [
            "llm_provider",
            "anthropic_api_key", "anthropic_model",
            "groq_api_key", "groq_model",
            "ollama_host", "ollama_model",
            "vertex_project_id", "vertex_region", "vertex_model", "vertex_sa_key",
        ];
        for (const key of allowed) {
            const val = (body.settings as Record<string, unknown>)[key];
            if (typeof val === "string" && val.trim()) {
                (merged as Record<string, string>)[key] = val.trim();
            }
        }

        await saveSettings(userId, merged);
        return NextResponse.json({ success: true });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const userId = await getUserId();
    if (!userId) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const deleted = await deleteSettings(userId);
    return NextResponse.json({ deleted });
}
