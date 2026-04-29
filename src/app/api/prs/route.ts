import { NextRequest, NextResponse } from "next/server";
import {
  getPullDetail,
  listCheckRunsForRef,
  listPullRequests,
  listPullReviews,
  parseLinkHeader,
} from "@/lib/github";
import { computeReadiness } from "@/lib/readiness";

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
        const checkOwner = p.head.repo?.owner.login ?? owner;
        const checkRepo = p.head.repo?.name ?? repo;
        const [detail, reviews, checkRuns] = await Promise.all([
          getPullDetail(owner, repo, p.number),
          listPullReviews(owner, repo, p.number),
          listCheckRunsForRef(checkOwner, checkRepo, p.head.sha),
        ]);

        const readiness = computeReadiness({
          draft: detail.draft,
          mergeable: detail.mergeable,
          mergeable_state: detail.mergeable_state,
          reviews,
          checkRuns,
        });

        const failing = checkRuns.filter(
          (r) =>
            r.status === "completed" &&
            (r.conclusion === "failure" ||
              r.conclusion === "timed_out" ||
              r.conclusion === "action_required"),
        ).length;
        const pending = checkRuns.filter((r) => r.status !== "completed").length;

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
          checks: { total: checkRuns.length, failing, pending },
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
