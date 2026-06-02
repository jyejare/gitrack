import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRules, saveRules, deleteRules, type AssignmentRule } from "@/lib/assignment-store";

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

    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();

    if (!owner || !repo) {
        return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    const rules = await getRules(userId, owner, repo);
    return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
    try {
        const userId = await getUserId();
        if (!userId) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const body = (await req.json()) as { owner?: string; repo?: string; rules?: AssignmentRule[] };
        const { owner, repo, rules } = body;

        if (!owner?.trim() || !repo?.trim()) {
            return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
        }
        if (!Array.isArray(rules)) {
            return NextResponse.json({ error: "rules array is required" }, { status: 400 });
        }

        await saveRules(userId, owner.trim(), repo.trim(), rules);
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

    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();

    if (!owner || !repo) {
        return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    const deleted = await deleteRules(userId, owner, repo);
    return NextResponse.json({ deleted });
}
