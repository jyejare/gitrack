import { NextRequest, NextResponse } from "next/server";
import { fetchRepoRules } from "@/lib/github";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const owner = searchParams.get("owner")?.trim();
        const repo = searchParams.get("repo")?.trim();

        if (!owner || !repo) {
            return NextResponse.json(
                { error: "owner and repo are required" },
                { status: 400 },
            );
        }

        const rules = await withSessionOverrides(req, (_llm) =>
            fetchRepoRules(owner, repo),
        { requireLlm: false });

        return NextResponse.json({ rules });
    } catch (e) {
        if (e instanceof UnauthenticatedError) {
            return NextResponse.json({ error: e.message }, { status: 401 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
