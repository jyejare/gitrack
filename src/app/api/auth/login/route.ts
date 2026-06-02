import { NextRequest, NextResponse } from "next/server";
import { verifyGitHubToken, createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as { token?: string };
        const token = body.token?.trim();
        if (!token) {
            return NextResponse.json({ error: "GitHub token is required" }, { status: 400 });
        }

        const user = await verifyGitHubToken(token);
        await createSession(user, token);

        return NextResponse.json({ user });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to verify token";
        return NextResponse.json({ error: message }, { status: 401 });
    }
}
