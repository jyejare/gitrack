import { NextRequest, NextResponse } from "next/server";
import {
  getPullDetail,
  listCheckRunsForRef,
  listCommitStatuses,
  listPullRequests,
  listPullReviews,
  parseLinkHeader,
} from "@/lib/github";
import { computeReadiness, summarizeChecks } from "@/lib/readiness";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(30, Math.max(1, Number(searchParams.get("perPage") ?? "10") || 10));
    const stateParam = (searchParams.get("state") ?? "open").toLowerCase();
    const state =
      stateParam === "closed" || stateParam === "all" ? (stateParam as "closed" | "all") : "open";

    if (!owner || !repo) {
      return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
    }

    const { pulls, link } = await listPullRequests(owner, repo, { state, page, perPage });
    const pages = parseLinkHeader(link);

    const enriched = await Promise.all(
      pulls.map(async (p) => {
        const [detail, reviews, checkRuns, commitStatuses] = await Promise.all([
          getPullDetail(owner, repo, p.number),
          listPullReviews(owner, repo, p.number),
          listCheckRunsForRef(owner, repo, p.head.sha).catch(() => []),
          listCommitStatuses(owner, repo, p.head.sha).catch(() => []),
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
          updated_at: detail.updated_at,
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
      }),
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
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
