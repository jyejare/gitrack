import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRules, type PrSizeLabel } from "@/lib/assignment-store";

export const runtime = "nodejs";

function computeSizeLabel(additions: number, deletions: number): PrSizeLabel {
    const total = additions + deletions;
    if (total > 10000) return "XXL";
    if (total > 5000) return "XL";
    if (total > 1000) return "L";
    if (total > 500) return "M";
    if (total > 100) return "S";
    return "XS";
}

type PrInput = {
    number: number;
    title: string;
    author: string;
    additions: number;
    deletions: number;
};

function matchRules(
    rules: { sizes: PrSizeLabel[]; keywords: string[]; reviewers: string[]; enabled: boolean }[],
    pr: PrInput,
): string[] {
    const size = computeSizeLabel(pr.additions, pr.deletions);
    const matched = new Set<string>();

    for (const rule of rules) {
        if (!rule.enabled) continue;

        const sizeMatch = rule.sizes.length === 0 || rule.sizes.includes(size);
        if (!sizeMatch) continue;

        const keywordMatch =
            rule.keywords.length === 0 ||
            rule.keywords.some((kw) => pr.title.toLowerCase().includes(kw.toLowerCase()));
        if (!keywordMatch) continue;

        for (const reviewer of rule.reviewers) {
            if (reviewer !== pr.author) {
                matched.add(reviewer);
            }
        }
    }

    return Array.from(matched);
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            pulls?: PrInput[];
        };
        const { owner, repo, pulls } = body;

        if (!owner?.trim() || !repo?.trim() || !Array.isArray(pulls)) {
            return NextResponse.json({ error: "owner, repo, and pulls[] are required" }, { status: 400 });
        }

        const userId = session.user.login;
        const rules = await getRules(userId, owner.trim(), repo.trim());

        const assignments: Record<number, string[]> = {};
        for (const pr of pulls) {
            const reviewers = matchRules(rules, pr);
            if (reviewers.length > 0) {
                assignments[pr.number] = reviewers;
            }
        }

        return NextResponse.json({ assignments });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
