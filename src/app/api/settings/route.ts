import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// Settings are now fully client-side (localStorage).
// These endpoints exist only for backward compatibility and return no-ops.

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ settings: null });
}

export async function POST() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ success: true });
}

export async function DELETE() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.json({ deleted: true });
}
