import { NextRequest, NextResponse } from "next/server";
import {
  getLatestCommentDate,
  getPullDetail,
  listCheckRunsForRef,
  listCommitStatuses,
  listPullRequests,
  listPullReviews,
  parseLinkHeader,
  type PullListItem,
} from "@/lib/github";
import { computeReadiness, summarizeChecks } from "@/lib/readiness";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

async function enrichPull(owner: string, repo: string, prNumber: number) {
  const [detail, reviews, latestComment] = await Promise.all([
    getPullDetail(owner, repo, prNumber),
    listPullReviews(owner, repo, prNumber),
    getLatestCommentDate(owner, repo, prNumber).catch(() => null),
  ]);
  const [checkRuns, commitStatuses] = await Promise.all([
    listCheckRunsForRef(owner, repo, detail.head.sha).catch(() => []),
    listCommitStatuses(owner, repo, detail.head.sha).catch(() => []),
  ]);
  const allChecks = [...checkRuns, ...commitStatuses];
  const checks = summarizeChecks(allChecks);
  const readiness = computeReadiness({
    draft: detail.draft,
    mergeable: detail.mergeable,
    mergeable_state: detail.mergeable_state,
    reviews,
    checkRuns: allChecks,
  });

  const activityDates: number[] = [];
  for (const r of reviews) {
    if (r.submitted_at) activityDates.push(Date.parse(r.submitted_at));
  }
  if (latestComment) activityDates.push(Date.parse(latestComment));
  const last_activity_at =
    activityDates.length > 0
      ? new Date(Math.max(...activityDates)).toISOString()
      : null;

  return {
    number: detail.number,
    title: detail.title,
    author: detail.user?.login ?? "",
    state: detail.state,
    draft: detail.draft,
    mergeable: detail.mergeable,
    mergeable_state: detail.mergeable_state,
    head: detail.head.ref,
    base: detail.base.ref,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    last_activity_at,
    comments: detail.comments,
    review_comments: detail.review_comments,
    commits: detail.commits,
    additions: detail.additions,
    deletions: detail.deletions,
    changed_files: detail.changed_files,
    readiness,
    checks: { total: checks.total, failing: checks.failing, pending: checks.pending },
    reviews,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    const search = searchParams.get("search")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(30, Math.max(1, Number(searchParams.get("perPage") ?? "10") || 10));
    const stateParam = (searchParams.get("state") ?? "open").toLowerCase();
    const state =
      stateParam === "closed" || stateParam === "all" ? (stateParam as "closed" | "all") : "open";

    if (!owner || !repo) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    return await withSessionOverrides(req, async () => {
      if (search) {
        const prNum = Number(search);
        if (Number.isFinite(prNum) && prNum > 0 && String(prNum) === search) {
          const enriched = await enrichPull(owner, repo, prNum).catch(() => null);
          return NextResponse.json({
            pulls: enriched ? [enriched] : [],
            pagination: { page: 1, perPage: 1, nextPage: null, lastPage: 1, hasMore: false },
          });
        }

        const searchLower = search.toLowerCase();
        const allPulls: PullListItem[] = [];
        let pg = 1;
        while (allPulls.length < 100) {
          const { pulls: batch } = await listPullRequests(owner, repo, { state, page: pg, perPage: 30 });
          if (batch.length === 0) break;
          allPulls.push(...batch);
          if (batch.length < 30) break;
          pg++;
        }

        const matched = allPulls.filter((p) =>
          p.title.toLowerCase().includes(searchLower) ||
          p.user?.login.toLowerCase().includes(searchLower) ||
          p.head.ref.toLowerCase().includes(searchLower)
        );

        const enriched = await Promise.all(
          matched.slice(0, 20).map((p) => enrichPull(owner, repo, p.number).catch(() => null)),
        );
        return NextResponse.json({
          pulls: enriched.filter(Boolean),
          pagination: { page: 1, perPage: matched.length, nextPage: null, lastPage: 1, hasMore: false },
        });
      }

      const { pulls, link } = await listPullRequests(owner, repo, { state, page, perPage });
      const pages = parseLinkHeader(link);
      const enriched = await Promise.all(
        pulls.map((p) => enrichPull(owner, repo, p.number)),
      );

      return NextResponse.json({
        pulls: enriched,
        pagination: {
          page,
          perPage,
          nextPage: pages.next ?? null,
          lastPage: pages.last ?? null,
          hasMore: pages.next !== undefined,
        },
      });
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
