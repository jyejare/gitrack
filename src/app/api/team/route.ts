import { NextRequest, NextResponse } from "next/server";
import { listCollaborators } from "@/lib/github";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const owner = searchParams.get("owner")?.trim();
        const repo = searchParams.get("repo")?.trim();

        if (!owner || !repo) {
            return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
        }

        return await withSessionOverrides(req, async () => {
            const collaborators = await listCollaborators(owner, repo);
            const team = collaborators.map((c) => ({
                login: c.login,
                avatar_url: c.avatar_url,
            }));
            return NextResponse.json({ team });
        });
    } catch (e) {
        if (e instanceof UnauthenticatedError) {
            return NextResponse.json({ error: e.message }, { status: 401 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
