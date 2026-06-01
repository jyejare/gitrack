import { NextRequest, NextResponse } from "next/server";
import { listRules, saveRule, deleteRule } from "@/lib/rules-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const owner = req.nextUrl.searchParams.get("owner")?.trim();
    const repo = req.nextUrl.searchParams.get("repo")?.trim();

    if (!owner || !repo) {
        return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    const rules = await listRules(owner, repo);
    return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            name?: string;
            prompt?: string;
        };

        const owner = body.owner?.trim();
        const repo = body.repo?.trim();
        const name = body.name?.trim();
        const prompt = body.prompt?.trim();

        if (!owner || !repo || !name || !prompt) {
            return NextResponse.json(
                { error: "owner, repo, name, and prompt are required" },
                { status: 400 },
            );
        }

        const rule = await saveRule(owner, repo, name, prompt);
        return NextResponse.json({ rule });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            name?: string;
        };

        const owner = body.owner?.trim();
        const repo = body.repo?.trim();
        const name = body.name?.trim();

        if (!owner || !repo || !name) {
            return NextResponse.json(
                { error: "owner, repo, and name are required" },
                { status: 400 },
            );
        }

        const deleted = await deleteRule(owner, repo, name);
        return NextResponse.json({ deleted });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
