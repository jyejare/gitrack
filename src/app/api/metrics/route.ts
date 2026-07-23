import { NextRequest, NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGithubToken } from "@/lib/request-context";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

type SearchIssue = {
    number: number;
    title: string;
    state: string;
    user: { login: string } | null;
    created_at: string;
    closed_at: string | null;
    pull_request?: {
        merged_at: string | null;
    };
    labels: Array<{ name: string }>;
};

type SearchResponse = {
    total_count: number;
    items: SearchIssue[];
};

function weekKey(date: string): string {
    const d = new Date(date);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
    return monday.toISOString().slice(0, 10);
}

function sizeBucket(additions: number, deletions: number): string {
    const total = additions + deletions;
    if (total <= 10) return "XS";
    if (total <= 50) return "S";
    if (total <= 200) return "M";
    if (total <= 500) return "L";
    return "XL";
}

async function searchAllPrs(
    owner: string,
    repo: string,
    qualifier: string,
    maxPages = 5,
): Promise<SearchIssue[]> {
    const all: SearchIssue[] = [];
    for (let page = 1; page <= maxPages; page++) {
        const q = encodeURIComponent(`repo:${owner}/${repo} is:pr ${qualifier}`);
        const res = await githubFetch(
            `/search/issues?q=${q}&per_page=100&page=${page}&sort=created&order=desc`,
        );
        const json = (await res.json()) as SearchResponse;
        all.push(...json.items);
        if (all.length >= json.total_count || json.items.length < 100) break;
    }
    return all;
}

export async function GET(req: NextRequest) {
    const owner = req.nextUrl.searchParams.get("owner")?.trim();
    const repo = req.nextUrl.searchParams.get("repo")?.trim();
    const days = Number(req.nextUrl.searchParams.get("days") ?? "30") || 30;

    if (!owner || !repo) {
        return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    return withSessionOverrides(req, async (_llm) => {
    try {
        const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

        const [openPrs, recentPrs] = await Promise.all([
            searchAllPrs(owner, repo, "is:open"),
            searchAllPrs(owner, repo, `created:>=${since}`),
        ]);

        const mergedPrs = recentPrs.filter((p) => p.pull_request?.merged_at);
        const closedPrs = recentPrs.filter((p) => p.state === "closed" && !p.pull_request?.merged_at);

        // Time-to-merge for merged PRs (hours)
        const mergeTimes = mergedPrs
            .filter((p) => p.pull_request?.merged_at)
            .map((p) => (Date.parse(p.pull_request!.merged_at!) - Date.parse(p.created_at)) / 3_600_000);
        const avgMergeTimeHours = mergeTimes.length > 0
            ? Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length)
            : 0;

        // PR age for open PRs (days)
        const openAges = openPrs.map((p) => (Date.now() - Date.parse(p.created_at)) / 86_400_000);
        const avgOpenAgeDays = openAges.length > 0
            ? Math.round(openAges.reduce((a, b) => a + b, 0) / openAges.length)
            : 0;

        // Weekly throughput
        const weeklyOpened: Record<string, number> = {};
        const weeklyMerged: Record<string, number> = {};
        for (const p of recentPrs) {
            const wk = weekKey(p.created_at);
            weeklyOpened[wk] = (weeklyOpened[wk] ?? 0) + 1;
        }
        for (const p of mergedPrs) {
            const wk = weekKey(p.pull_request!.merged_at!);
            weeklyMerged[wk] = (weeklyMerged[wk] ?? 0) + 1;
        }
        const allWeeks = [...new Set([...Object.keys(weeklyOpened), ...Object.keys(weeklyMerged)])].sort();
        const throughput = allWeeks.map((week) => ({
            week,
            opened: weeklyOpened[week] ?? 0,
            merged: weeklyMerged[week] ?? 0,
        }));

        // Size distribution via GitHub GraphQL API (batched into single requests)
        const sizeDist: Record<string, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
        const ghToken = getGithubToken();
        const prNumbers = recentPrs.map((p) => p.number);
        if (prNumbers.length > 0 && ghToken) {
            const aliases = prNumbers.map(
                (n) => `pr${n}: pullRequest(number: ${n}) { additions deletions }`,
            );
            const batchSize = 50;
            for (let i = 0; i < aliases.length; i += batchSize) {
                const chunk = aliases.slice(i, i + batchSize);
                const query = `query { repository(owner: "${owner}", name: "${repo}") { ${chunk.join(" ")} } }`;
                try {
                    const res = await fetch("https://api.github.com/graphql", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${ghToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ query }),
                    });
                    if (!res.ok) continue;
                    const json = (await res.json()) as {
                        data?: { repository?: Record<string, { additions: number; deletions: number } | null> };
                    };
                    const repoData = json.data?.repository;
                    if (repoData) {
                        for (const key of Object.keys(repoData)) {
                            const pr = repoData[key];
                            if (pr && typeof pr.additions === "number" && typeof pr.deletions === "number") {
                                sizeDist[sizeBucket(pr.additions, pr.deletions)]++;
                            }
                        }
                    }
                } catch {
                    // GraphQL batch failed, skip
                }
            }
        }
        const sizeDistribution = Object.entries(sizeDist)
            .filter(([, count]) => count > 0)
            .map(([size, count]) => ({ size, count }));

        return NextResponse.json({
            period: { days, since },
            counts: {
                totalOpen: openPrs.length,
                mergedInPeriod: mergedPrs.length,
                closedInPeriod: closedPrs.length,
                createdInPeriod: recentPrs.length,
            },
            averages: {
                mergeTimeHours: avgMergeTimeHours,
                openAgeDays: avgOpenAgeDays,
            },
            throughput,
            sizeDistribution,
        });
    } catch (e) {
        if (e instanceof UnauthenticatedError) {
            return NextResponse.json({ error: e.message }, { status: 401 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}, { requireLlm: false });
}
