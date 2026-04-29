"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAiMode } from "@/components/AiModeContext";

type ReviewItem = {
  id: number;
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
};

type PullRow = {
  number: number;
  title: string;
  author: string;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: string;
  base: string;
  updated_at: string;
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  readiness: {
    score: number;
    breakdown: {
      draftPenalty: number;
      mergePenalty: number;
      reviewPenalty: number;
      checkPenalty: number;
      approvalBonus: number;
      pendingChecks: number;
      failingChecks: number;
      approvals: number;
      changesRequested: number;
    };
  };
  checks: { total: number; failing: number; pending: number };
  reviews: ReviewItem[];
};

type PrsResponse = {
  pulls: PullRow[];
  pagination: {
    page: number;
    perPage: number;
    nextPage: number | null;
    lastPage: number | null;
    hasMore: boolean;
  };
};

type PriorityView =
  | "all"
  | "reviewReady"
  | "needsChanges"
  | "blocked"
  | "waitingOnChecks"
  | "draft";

type PrioritySort = "updatedDesc" | "reviewReadyThenScore" | "highestReadiness" | "oldestUpdated";

function isConflicted(p: PullRow) {
  return p.mergeable === false || p.mergeable_state === "dirty";
}

function isReviewReady(p: PullRow) {
  if (p.draft) return false;
  if (p.mergeable === null) return false;
  if (isConflicted(p)) return false;
  if (p.checks.failing > 0) return false;
  if (p.checks.pending > 0) return false;
  if (p.readiness.breakdown.changesRequested > 0) return false;
  return p.readiness.score >= 80;
}

function reviewReadyReason(p: PullRow) {
  if (p.draft) return "Draft PR";
  if (p.mergeable === null) return "Mergeability unknown";
  if (isConflicted(p)) return "Merge conflict / dirty";
  if (p.checks.failing > 0) return `Failing checks: ${p.checks.failing}`;
  if (p.checks.pending > 0) return `Pending checks: ${p.checks.pending}`;
  if (p.readiness.breakdown.changesRequested > 0) return `Changes requested: ${p.readiness.breakdown.changesRequested}`;
  if (p.readiness.score < 80) return `Low readiness score (${p.readiness.score})`;
  return "Ready for review";
}

function scoreTone(score: number) {
  if (score >= 80) return "text-emerald-300";
  if (score >= 55) return "text-amber-300";
  return "text-rose-300";
}

function summarizeReviews(reviews: ReviewItem[]) {
  const latestByUser = new Map<string, ReviewItem>();
  const sorted = [...reviews].sort((a, b) => {
    const ta = a.submitted_at ? Date.parse(a.submitted_at) : 0;
    const tb = b.submitted_at ? Date.parse(b.submitted_at) : 0;
    return ta - tb;
  });
  for (const r of sorted) {
    const login = r.user?.login;
    if (!login) continue;
    latestByUser.set(login, r);
  }
  let approved = 0;
  let changes = 0;
  let commented = 0;
  for (const r of latestByUser.values()) {
    if (r.state === "APPROVED") approved += 1;
    else if (r.state === "CHANGES_REQUESTED") changes += 1;
    else if (r.state === "COMMENTED") commented += 1;
  }
  return { approved, changes, commented, participants: latestByUser.size };
}

export function Dashboard() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const { aiMode, setAiMode } = useAiMode();

  const [priorityView, setPriorityView] = useState<PriorityView>("all");
  const [prioritySort, setPrioritySort] = useState<PrioritySort>("updatedDesc");

  const [detailsOpenFor, setDetailsOpenFor] = useState<number | null>(null);
  const [insightsByPr, setInsightsByPr] = useState<
    Record<number, { loading: boolean; markdown?: string; error?: string }>
  >({});

  const [data, setData] = useState<PrsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reviewOpenFor, setReviewOpenFor] = useState<number | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMarkdown, setReviewMarkdown] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState<string | null>(null);

  const canLoad = owner.trim() && repo.trim();

  useEffect(() => {
    // Keep AI-only UI from showing stale AI output when AI mode is toggled off.
    if (!aiMode) {
      setDetailsOpenFor(null);
      setReviewOpenFor(null);
      setReviewMarkdown(null);
      setReviewError(null);
    }
  }, [aiMode]);

  const fetchPrs = useCallback(
    async (targetPage: number) => {
      if (!canLoad) return;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({
          owner: owner.trim(),
          repo: repo.trim(),
          page: String(targetPage),
          perPage: String(perPage),
          state,
        });
        const res = await fetch(`/api/prs?${q.toString()}`);
        const json = (await res.json()) as PrsResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }
        setData(json);
        setPage(targetPage);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : "Failed to load PRs");
      } finally {
        setLoading(false);
      }
    },
    [canLoad, owner, repo, perPage, state],
  );

  const runReview = async (number: number) => {
    if (!canLoad || !aiMode) return;
    setReviewOpenFor(number);
    setReviewLoading(true);
    setReviewError(null);
    setReviewMarkdown(null);
    setReviewModel(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: owner.trim(), repo: repo.trim(), number }),
      });
      const json = (await res.json()) as {
        markdown?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `Review failed (${res.status})`);
      }
      setReviewMarkdown(json.markdown ?? "");
      setReviewModel(json.model ?? null);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setReviewLoading(false);
    }
  };

  const reviewAllOnPage = async () => {
    if (!data?.pulls.length) return;

    const all = [...data.pulls];
    let out = all;

    if (priorityView !== "all") {
      out = out.filter((p) => {
        if (priorityView === "reviewReady") return isReviewReady(p);
        if (priorityView === "needsChanges") return p.readiness.breakdown.changesRequested > 0;
        if (priorityView === "blocked") return isConflicted(p) || p.checks.failing > 0;
        if (priorityView === "waitingOnChecks") return p.checks.pending > 0;
        if (priorityView === "draft") return p.draft;
        return true;
      });
    }

    if (prioritySort === "updatedDesc") {
      // Keep API ordering (updated desc).
    } else if (prioritySort === "reviewReadyThenScore") {
      out.sort((a, b) => {
        const ar = isReviewReady(a) ? 1 : 0;
        const br = isReviewReady(b) ? 1 : 0;
        if (br !== ar) return br - ar;
        if (b.readiness.score !== a.readiness.score) return b.readiness.score - a.readiness.score;
        return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      });
    } else if (prioritySort === "highestReadiness") {
      out.sort((a, b) => {
        if (b.readiness.score !== a.readiness.score) return b.readiness.score - a.readiness.score;
        return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      });
    } else {
      // oldestUpdated
      out.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    }

    for (const p of out) {
      await runReview(p.number);
    }
  };

  const runInsights = useCallback(
    async (number: number) => {
      if (!canLoad || !aiMode) return;
      const trimmedOwner = owner.trim();
      const trimmedRepo = repo.trim();

      setInsightsByPr((prev) => ({
        ...prev,
        [number]: { loading: true },
      }));

      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: trimmedOwner, repo: trimmedRepo, number }),
        });
        const json = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? `Insights failed (${res.status})`);
        }

        setInsightsByPr((prev) => ({
          ...prev,
          [number]: { loading: false, markdown: json.markdown ?? "" },
        }));
      } catch (e) {
        setInsightsByPr((prev) => ({
          ...prev,
          [number]: { loading: false, error: e instanceof Error ? e.message : "Insights failed" },
        }));
      }
    },
    [aiMode, canLoad, owner, repo],
  );

  useEffect(() => {
    if (!aiMode) return;
    if (detailsOpenFor === null) return;
    const cur = insightsByPr[detailsOpenFor];
    if (cur?.loading) return;
    // If we already attempted generation (markdown is set even if empty), don't retry automatically.
    if (cur?.markdown !== undefined) return;
    if (cur?.error) return;
    // Lazy-load reviewer insights for the expanded PR row.
    void runInsights(detailsOpenFor);
  }, [aiMode, detailsOpenFor, insightsByPr, runInsights]);

  const pullsForTable = useMemo(() => {
    const all = data?.pulls ?? [];
    let out = [...all];

    if (priorityView !== "all") {
      out = out.filter((p) => {
        if (priorityView === "reviewReady") return isReviewReady(p);
        if (priorityView === "needsChanges") return p.readiness.breakdown.changesRequested > 0;
        if (priorityView === "blocked") return isConflicted(p) || p.checks.failing > 0;
        if (priorityView === "waitingOnChecks") return p.checks.pending > 0;
        if (priorityView === "draft") return p.draft;
        return true;
      });
    }

    if (prioritySort === "updatedDesc") return out;

    if (prioritySort === "reviewReadyThenScore") {
      out.sort((a, b) => {
        const ar = isReviewReady(a) ? 1 : 0;
        const br = isReviewReady(b) ? 1 : 0;
        if (br !== ar) return br - ar;
        if (b.readiness.score !== a.readiness.score) return b.readiness.score - a.readiness.score;
        return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      });
      return out;
    }

    if (prioritySort === "highestReadiness") {
      out.sort((a, b) => {
        if (b.readiness.score !== a.readiness.score) return b.readiness.score - a.readiness.score;
        return Date.parse(b.updated_at) - Date.parse(a.updated_at);
      });
      return out;
    }

    // oldestUpdated
    out.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    return out;
  }, [data, prioritySort, priorityView]);

  const paginationLabel = useMemo(() => {
    if (!data) return "";
    const { pagination } = data;
    const last = pagination.lastPage ? ` / ${pagination.lastPage}` : "";
    return `Page ${pagination.page}${last}`;
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</span>
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              placeholder="e.g. acme-corp"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Repo</span>
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              placeholder="e.g. billing-service"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">State</span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              value={state}
              onChange={(e) => setState(e.target.value as typeof state)}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Per page</span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
              value={String(perPage)}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
            >
              {[5, 10, 20, 30].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canLoad || loading}
            onClick={() => void fetchPrs(1)}
          >
            Load PRs
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canLoad || loading || !data}
            onClick={() => void fetchPrs(page)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded-md border border-amber-900/60 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-950/70 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canLoad || !data?.pulls.length || reviewLoading || !aiMode}
            onClick={() => void reviewAllOnPage()}
            title="Runs reviews sequentially; the panel will show only the last PR in the batch (v1 limitation)."
          >
            Review all on page
          </button>
          <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={aiMode}
              onChange={(e) => setAiMode(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span className="text-slate-100">AI mode</span>
          </label>
          <span className="text-xs text-slate-500">{paginationLabel}</span>
        </div>

        {error ? (
          <p className="mt-3 rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
            {error}
          </p>
        ) : null}
      </section>

      {data ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Pull requests</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900 disabled:opacity-40"
                disabled={page <= 1 || loading}
                onClick={() => void fetchPrs(Math.max(1, page - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900 disabled:opacity-40"
                disabled={!data.pagination.hasMore || loading}
                onClick={() => void fetchPrs(page + 1)}
              >
                Next
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Priority view</span>
                <select
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
                  value={priorityView}
                  onChange={(e) => setPriorityView(e.target.value as PriorityView)}
                >
                  <option value="all">All</option>
                  <option value="reviewReady">Review ready</option>
                  <option value="needsChanges">Needs changes</option>
                  <option value="blocked">Blocked (failing checks)</option>
                  <option value="waitingOnChecks">Waiting on checks</option>
                  <option value="draft">Draft</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Sort</span>
                <select
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
                  value={prioritySort}
                  onChange={(e) => setPrioritySort(e.target.value as PrioritySort)}
                >
                  <option value="updatedDesc">Recently updated</option>
                  <option value="reviewReadyThenScore">Review ready first</option>
                  <option value="highestReadiness">Highest readiness</option>
                  <option value="oldestUpdated">Oldest updated</option>
                </select>
              </label>
            </div>

            <div className="text-xs text-slate-500">
              Showing {pullsForTable.length} / {data.pulls.length}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Review Ready</th>
                  <th className="px-3 py-2">Checks</th>
                  <th className="px-3 py-2">ACK</th>
                  <th className="px-3 py-2">Comments</th>
                  <th className="px-3 py-2">Merge</th>
                  <th className="px-3 py-2">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                {pullsForTable.map((p) => {
                  const ack = summarizeReviews(p.reviews);
                  const ready = isReviewReady(p);
                  const expanded = detailsOpenFor === p.number;
                  const ins = insightsByPr[p.number];

                  return (
                    <Fragment key={p.number}>
                      <tr className="align-top">
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-slate-900 disabled:opacity-40"
                              aria-label={`Toggle details for PR #${p.number}`}
                              aria-expanded={expanded}
                              onClick={() => setDetailsOpenFor(expanded ? null : p.number)}
                            >
                              <span
                                className="inline-block text-slate-400 transition-transform"
                                style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
                              >
                                ▸
                              </span>
                            </button>

                            <div className="min-w-0">
                              <div className="font-medium text-slate-100">#{p.number}</div>
                              <div className="max-w-xs text-xs text-slate-400">{p.title}</div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {p.author} · {p.head} → {p.base}
                                {p.draft ? " · draft" : ""}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          <div className={`text-lg font-semibold ${scoreTone(p.readiness.score)}`}>
                            {p.readiness.score}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            +{p.readiness.breakdown.approvalBonus} bonus · −{p.readiness.breakdown.checkPenalty}{" "}
                            checks
                          </div>
                        </td>

                        <td className="px-3 py-3 text-xs">
                          <div
                            title={reviewReadyReason(p)}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
                              ready
                                ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-100"
                                : "border-amber-900/60 bg-amber-950/40 text-amber-100"
                            }`}
                          >
                            {ready ? "Ready" : "Not ready"}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div>total {p.checks.total}</div>
                          <div className="text-rose-300">fail {p.checks.failing}</div>
                          <div className="text-amber-200">pending {p.checks.pending}</div>
                        </td>

                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div className="text-emerald-300">approve {ack.approved}</div>
                          <div className="text-rose-300">changes {ack.changes}</div>
                          <div className="text-slate-400">comment {ack.commented}</div>
                          <div className="text-slate-500">people {ack.participants}</div>
                        </td>

                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div>issue {p.comments}</div>
                          <div>review {p.review_comments}</div>
                          <div className="text-slate-500">commits {p.commits}</div>
                        </td>

                        <td className="px-3 py-3 text-xs text-slate-300">
                          <div>
                            mergeable:{" "}
                            {p.mergeable === null ? "unknown" : p.mergeable ? "yes" : "no"}
                          </div>
                          {p.mergeable_state ? (
                            <div className="text-slate-500">{p.mergeable_state}</div>
                          ) : null}
                        </td>

                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-900 disabled:opacity-40"
                            disabled={!aiMode || reviewLoading}
                            title={!aiMode ? "Enable AI mode to run AI review" : undefined}
                            onClick={() => void runReview(p.number)}
                          >
                            Claude review
                          </button>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-3">
                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-100">
                                    Reviewer context for #{p.number}
                                  </div>
                                  <div className="mt-2 grid gap-1 text-xs text-slate-300">
                                    <div>
                                      Readiness score:{" "}
                                      <span className={ready ? "text-emerald-300" : "text-amber-200"}>{p.readiness.score}</span>
                                    </div>
                                    <div>
                                      Checks:{" "}
                                      <span className="text-rose-300">{p.checks.failing} failing</span>{" "}
                                      · <span className="text-amber-200">{p.checks.pending} pending</span>
                                    </div>
                                    <div>
                                      Changes requested: <span>{p.readiness.breakdown.changesRequested}</span>
                                      {" · "}
                                      Approvals: <span>{p.readiness.breakdown.approvals}</span>
                                    </div>
                                    <div>
                                      Mergeability:{" "}
                                      {p.mergeable === null ? "unknown" : p.mergeable ? "clean" : "conflict/dirty"}
                                    </div>
                                  </div>
                                </div>

                                <div className="w-full md:max-w-xl">
                                  {aiMode ? (
                                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                                      <div className="flex items-center justify-between gap-3">
                                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                          Reviewer insights
                                        </h3>
                                        {ins?.loading ? (
                                          <span className="text-xs text-slate-400">Generating…</span>
                                        ) : null}
                                      </div>

                                      {ins?.error ? (
                                        <p className="mt-2 rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                                          {ins.error}
                                        </p>
                                      ) : null}

                                      {ins?.markdown ? (
                                        <article className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
                                          {ins.markdown}
                                        </article>
                                      ) : null}

                                      {!ins?.loading && (!ins?.markdown || (ins?.markdown?.length ?? 0) === 0) ? (
                                        <div className="mt-2">
                                          <button
                                            type="button"
                                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                            onClick={() => void runInsights(p.number)}
                                          >
                                            Generate insights
                                          </button>
                                          <p className="mt-1 text-[11px] text-slate-500">
                                            Based on the PR diff; may take a moment.
                                          </p>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
                                      Enable AI mode to generate reviewer insights for this PR.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            Changing per-page resets the selector to page 1; click Load PRs again if you want that slice
            immediately.
          </p>
        </section>
      ) : null}

      {reviewOpenFor !== null ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="text-sm font-medium">
                Review for #{reviewOpenFor}
                {reviewModel ? <span className="text-slate-500"> · {reviewModel}</span> : null}
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                onClick={() => {
                  setReviewOpenFor(null);
                  setReviewMarkdown(null);
                  setReviewError(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto p-4 text-sm">
              {reviewLoading ? <p className="text-slate-400">Generating review…</p> : null}
              {reviewError ? (
                <p className="rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-rose-100">
                  {reviewError}
                </p>
              ) : null}
              {reviewMarkdown ? (
                <article className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-200">
                  {reviewMarkdown}
                </article>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
