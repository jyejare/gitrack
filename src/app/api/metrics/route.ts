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

type GqlReviewNode = {
    author: { login: string } | null;
    state: string;
    submittedAt: string | null;
};

type GqlCheckRun = {
    name: string;
    conclusion: string | null;
};

type GqlPrData = {
    additions: number;
    deletions: number;
    reviews: { nodes: GqlReviewNode[] };
    commits: {
        nodes: Array<{
            commit: {
                checkSuites: {
                    nodes: Array<{
                        checkRuns: { nodes: GqlCheckRun[] };
                    }>;
                };
            };
        }>;
    };
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

function median(sorted: number[]): number {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

async function graphqlBatch(
    ghToken: string,
    owner: string,
    repo: string,
    prNumbers: number[],
): Promise<Map<number, GqlPrData>> {
    const result = new Map<number, GqlPrData>();
    if (prNumbers.length === 0) return result;

    const aliases = prNumbers.map(
        (n) => `pr${n}: pullRequest(number: ${n}) {
            additions deletions
            reviews(first: 50) { nodes { author { login } state submittedAt } }
            commits(last: 1) { nodes { commit { checkSuites(first: 10) { nodes { checkRuns(first: 50) { nodes { name conclusion } } } } } } }
        }`,
    );
    const batchSize = 30;
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
                data?: { repository?: Record<string, GqlPrData | null> };
            };
            const repoData = json.data?.repository;
            if (repoData) {
                for (const key of Object.keys(repoData)) {
                    const pr = repoData[key];
                    if (pr && typeof pr.additions === "number") {
                        const num = Number(key.replace("pr", ""));
                        result.set(num, pr);
                    }
                }
            }
        } catch {
            // GraphQL batch failed, skip
        }
    }
    return result;
}

export async function GET(req: NextRequest) {
    const owner = req.nextUrl.searchParams.get("owner")?.trim();
    const repo = req.nextUrl.searchParams.get("repo")?.trim();
    const days = Number(req.nextUrl.searchParams.get("days") ?? "30") || 30;
    const staleDays = Number(req.nextUrl.searchParams.get("staleDays") ?? "14") || 14;

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
        const sortedMergeTimes = [...mergeTimes].sort((a, b) => a - b);
        const avgMergeTimeHours = mergeTimes.length > 0
            ? Math.round(mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length)
            : 0;
        const medianMergeTimeHours = Math.round(median(sortedMergeTimes));

        // PR age for open PRs (days)
        const openAges = openPrs.map((p) => (Date.now() - Date.parse(p.created_at)) / 86_400_000);
        const avgOpenAgeDays = openAges.length > 0
            ? Math.round(openAges.reduce((a, b) => a + b, 0) / openAges.length)
            : 0;

        // Closed-without-merge rate
        const closedWithoutMergeRate = recentPrs.length > 0
            ? Math.round((closedPrs.length / recentPrs.length) * 100)
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

        // Label distribution from recent PRs
        const labelCounts: Record<string, number> = {};
        for (const p of recentPrs) {
            for (const l of p.labels) {
                labelCounts[l.name] = (labelCounts[l.name] ?? 0) + 1;
            }
        }
        const labelDistribution = Object.entries(labelCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([label, count]) => ({ label, count }));

        // Contributor stats from search results (author-level)
        const contributorCreated: Record<string, number> = {};
        const contributorMerged: Record<string, number> = {};
        for (const p of recentPrs) {
            const login = p.user?.login ?? "unknown";
            contributorCreated[login] = (contributorCreated[login] ?? 0) + 1;
        }
        for (const p of mergedPrs) {
            const login = p.user?.login ?? "unknown";
            contributorMerged[login] = (contributorMerged[login] ?? 0) + 1;
        }

        // GraphQL batch: size, reviews, CI checks
        const sizeDist: Record<string, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
        const ghToken = getGithubToken();
        const allPrNumbers = [...new Set([...recentPrs.map((p) => p.number), ...openPrs.map((p) => p.number)])];
        const gqlData = ghToken
            ? await graphqlBatch(ghToken, owner, repo, allPrNumbers)
            : new Map<number, GqlPrData>();

        // Size distribution
        for (const p of recentPrs) {
            const gql = gqlData.get(p.number);
            if (gql) {
                sizeDist[sizeBucket(gql.additions, gql.deletions)]++;
            }
        }
        const sizeDistribution = Object.entries(sizeDist)
            .filter(([, count]) => count > 0)
            .map(([size, count]) => ({ size, count }));

        // Review metrics: turnaround, approval rate, reviewer workload
        const reviewTurnaroundHours: number[] = [];
        let approvedWithoutChanges = 0;
        let prsWithReviews = 0;
        const reviewerCounts: Record<string, number> = {};
        const firstReviewTimes: Record<number, number> = {};

        for (const p of recentPrs) {
            const gql = gqlData.get(p.number);
            if (!gql?.reviews?.nodes?.length) continue;
            prsWithReviews++;

            const reviews = gql.reviews.nodes.filter((r) => r.submittedAt);
            if (reviews.length === 0) continue;

            // First review turnaround
            const firstReview = reviews.reduce((earliest, r) =>
                Date.parse(r.submittedAt!) < Date.parse(earliest.submittedAt!) ? r : earliest,
            );
            const turnaroundHrs = (Date.parse(firstReview.submittedAt!) - Date.parse(p.created_at)) / 3_600_000;
            if (turnaroundHrs >= 0) {
                reviewTurnaroundHours.push(turnaroundHrs);
                firstReviewTimes[p.number] = turnaroundHrs;
            }

            // Latest state per reviewer
            const latestByUser = new Map<string, string>();
            const sorted = [...reviews].sort((a, b) => Date.parse(a.submittedAt!) - Date.parse(b.submittedAt!));
            for (const r of sorted) {
                const login = r.author?.login;
                if (login) {
                    latestByUser.set(login, r.state);
                    reviewerCounts[login] = (reviewerCounts[login] ?? 0) + 1;
                }
            }

            const hasChangesRequested = [...latestByUser.values()].some((s) => s === "CHANGES_REQUESTED");
            const hasApproval = [...latestByUser.values()].some((s) => s === "APPROVED");
            if (hasApproval && !hasChangesRequested) approvedWithoutChanges++;
        }

        const avgReviewTurnaroundHours = reviewTurnaroundHours.length > 0
            ? Math.round(reviewTurnaroundHours.reduce((a, b) => a + b, 0) / reviewTurnaroundHours.length)
            : 0;
        const approvalRate = prsWithReviews > 0
            ? Math.round((approvedWithoutChanges / prsWithReviews) * 100)
            : 0;

        // Merge funnel: created → first review → merge (median hours per stage)
        const funnelFirstReview: number[] = [];
        const funnelReviewToMerge: number[] = [];
        for (const p of mergedPrs) {
            const frTime = firstReviewTimes[p.number];
            if (frTime !== undefined && frTime >= 0) {
                funnelFirstReview.push(frTime);
                const totalMergeHrs = (Date.parse(p.pull_request!.merged_at!) - Date.parse(p.created_at)) / 3_600_000;
                const reviewToMerge = totalMergeHrs - frTime;
                if (reviewToMerge >= 0) funnelReviewToMerge.push(reviewToMerge);
            }
        }
        const mergeFunnel = {
            medianToFirstReviewHours: Math.round(median([...funnelFirstReview].sort((a, b) => a - b))),
            medianFirstReviewToMergeHours: Math.round(median([...funnelReviewToMerge].sort((a, b) => a - b))),
            medianTotalMergeHours: medianMergeTimeHours,
        };

        // Reviewer workload (top 10)
        const reviewerWorkload = Object.entries(reviewerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([reviewer, count]) => ({ reviewer, count }));

        // CI health: pass rate from latest commit check suites
        let ciChecked = 0;
        let ciAllGreen = 0;
        for (const p of recentPrs) {
            const gql = gqlData.get(p.number);
            const commitNode = gql?.commits?.nodes?.[0];
            if (!commitNode?.commit?.checkSuites?.nodes?.length) continue;

            const allRuns = commitNode.commit.checkSuites.nodes.flatMap((s) => s.checkRuns?.nodes ?? []);
            if (allRuns.length === 0) continue;
            ciChecked++;

            const meaningful = allRuns.filter(
                (r) => r.conclusion && !["NEUTRAL", "SKIPPED"].includes(r.conclusion),
            );
            const allPassed = meaningful.length > 0 && meaningful.every((r) => r.conclusion === "SUCCESS");
            if (allPassed) ciAllGreen++;
        }
        const ciPassRate = ciChecked > 0 ? Math.round((ciAllGreen / ciChecked) * 100) : null;

        // Stale PRs: open PRs with no update in staleDays
        const staleThreshold = Date.now() - staleDays * 86_400_000;
        const stalePrs = openPrs
            .filter((p) => Date.parse(p.created_at) < staleThreshold)
            .map((p) => ({
                number: p.number,
                title: p.title,
                author: p.user?.login ?? "unknown",
                ageDays: Math.round((Date.now() - Date.parse(p.created_at)) / 86_400_000),
            }))
            .sort((a, b) => b.ageDays - a.ageDays)
            .slice(0, 10);

        // Top contributors (merge created+merged counts, add review counts)
        const allContributors = new Set([
            ...Object.keys(contributorCreated),
            ...Object.keys(contributorMerged),
            ...Object.keys(reviewerCounts),
        ]);
        const contributors = [...allContributors]
            .map((login) => ({
                login,
                created: contributorCreated[login] ?? 0,
                merged: contributorMerged[login] ?? 0,
                reviewed: reviewerCounts[login] ?? 0,
            }))
            .sort((a, b) => (b.created + b.merged + b.reviewed) - (a.created + a.merged + a.reviewed))
            .slice(0, 10);

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
                medianMergeTimeHours,
                openAgeDays: avgOpenAgeDays,
                reviewTurnaroundHours: avgReviewTurnaroundHours,
            },
            rates: {
                approvalRate,
                closedWithoutMergeRate,
                ciPassRate,
            },
            throughput,
            sizeDistribution,
            labelDistribution,
            mergeFunnel,
            reviewerWorkload,
            stalePrs,
            contributors,
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
