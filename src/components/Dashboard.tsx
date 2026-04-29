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

/* ── Glance renderer ─────────────────────────────────────────────────── */

type GlanceItem = { filePath: string; lineRange: string; explanation: string; code: string[] };

function parseGlance(md: string): GlanceItem[] {
  const raw = md.split(/^###\s+/m).filter((s) => s.trim());
  return raw.map((section) => {
    const lines = section.split("\n");
    const header = lines[0] ?? "";
    const pathMatch = header.match(/`([^`]+)`/);
    const filePath = pathMatch?.[1] ?? header.trim();
    const lineRange = header.replace(/`[^`]+`/, "").replace(/^\s*/, "").trim();

    const codeStart = lines.findIndex((l) => /^```/.test(l));
    let codeEnd = -1;
    if (codeStart >= 0) {
      codeEnd = lines.findIndex((l, j) => j > codeStart && /^```/.test(l));
      if (codeEnd < 0) codeEnd = lines.length;
    }

    const explanation =
      codeStart > 0
        ? lines.slice(1, codeStart).join("\n").trim()
        : lines.slice(1).join("\n").trim();

    const code = codeStart >= 0 ? lines.slice(codeStart + 1, codeEnd) : [];
    return { filePath, lineRange, explanation, code };
  });
}

function GlanceView({ markdown }: { markdown: string }) {
  const items = parseGlance(markdown);
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">No changes extracted.</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="flex-none rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <code className="text-xs font-semibold text-cyan-300">{item.filePath}</code>
            {item.lineRange ? (
              <span className="text-[11px] text-slate-500">{item.lineRange}</span>
            ) : null}
          </div>
          {item.explanation ? (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{item.explanation}</p>
          ) : null}
          {item.code.length > 0 ? (
            <pre className="mt-2 overflow-x-auto rounded-md border border-slate-700/50 bg-slate-950 p-2 text-[11px] leading-relaxed">
              {item.code.map((line, j) => (
                <div
                  key={j}
                  className={
                    line.startsWith("+")
                      ? "text-emerald-400"
                      : line.startsWith("-")
                        ? "text-rose-400"
                        : "text-slate-400"
                  }
                >
                  {line}
                </div>
              ))}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ── Insights / Review Guide renderer ────────────────────────────────── */

const SECTION_THEMES = [
  { border: "border-sky-800/50 bg-sky-950/25", heading: "text-sky-300" },
  { border: "border-amber-800/50 bg-amber-950/25", heading: "text-amber-300" },
  { border: "border-violet-800/50 bg-violet-950/25", heading: "text-violet-300" },
  { border: "border-teal-800/50 bg-teal-950/25", heading: "text-teal-300" },
];

function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-slate-800 px-1 py-0.5 text-cyan-300">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

type ContentBlock =
  | { kind: "item"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "text"; text: string };

function parseSectionContent(raw: string): ContentBlock[] {
  const lines = raw.split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      if (codeLines.length > 0) blocks.push({ kind: "code", lines: codeLines });
    } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, "").replace(/^\s*\d+[.)]\s+/, "");
      blocks.push({ kind: "item", text });
    } else if (line.trim()) {
      blocks.push({ kind: "text", text: line });
    }
    i++;
  }
  return blocks;
}

function InsightsView({ markdown }: { markdown: string }) {
  const parts = markdown.split(/^(?=#+\s+|\*\*[^*]+\*\*\s*$)/m).filter((s) => s.trim());
  if (parts.length === 0) {
    return (
      <article className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
        {markdown}
      </article>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-3">
      {parts.map((part, pi) => {
        const lines = part.split("\n");
        const isHeading = /^(#+\s+|\*\*[^*]+\*\*\s*$)/.test(lines[0]);
        const heading = lines[0]
          .replace(/^#+\s+/, "")
          .replace(/\*\*/g, "")
          .replace(/^["]+|["]+$/g, "")
          .trim();
        const content = lines.slice(isHeading ? 1 : 0).join("\n").trim();
        const theme = SECTION_THEMES[pi % SECTION_THEMES.length];
        const blocks = parseSectionContent(content);

        let itemNum = 0;
        return (
          <div key={pi} className={`rounded-lg border p-3 ${theme.border}`}>
            <h4 className={`text-xs font-semibold uppercase tracking-wide ${theme.heading}`}>
              {heading}
            </h4>
            {blocks.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1">
                {blocks.map((block, bi) => {
                  if (block.kind === "item") {
                    itemNum++;
                    return (
                      <div key={bi} className="text-xs leading-relaxed text-slate-200">
                        <span className="font-semibold text-slate-400">{itemNum}.</span>{" "}
                        <InlineCode text={block.text} />
                      </div>
                    );
                  }
                  if (block.kind === "code") {
                    return (
                      <pre key={bi} className="my-1 overflow-x-auto rounded-md border border-slate-700/50 bg-slate-950 p-2 text-[11px] leading-relaxed">
                        {block.lines.map((line, li) => (
                          <div
                            key={li}
                            className={
                              line.startsWith("+")
                                ? "text-emerald-400"
                                : line.startsWith("-")
                                  ? "text-rose-400"
                                  : "text-slate-300"
                            }
                          >
                            {line}
                          </div>
                        ))}
                      </pre>
                    );
                  }
                  return (
                    <p key={bi} className="text-xs leading-relaxed text-slate-300">
                      <InlineCode text={block.text} />
                    </p>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── PR size helper ──────────────────────────────────────────────────── */

type PrSize = { label: string; color: string };

function prSize(additions: number, deletions: number): PrSize {
  const total = additions + deletions;
  if (total > 1000) return { label: "XXL", color: "border-rose-700 bg-rose-950/50 text-rose-200" };
  if (total > 500) return { label: "XL", color: "border-orange-700 bg-orange-950/50 text-orange-200" };
  if (total > 250) return { label: "L", color: "border-amber-700 bg-amber-950/50 text-amber-200" };
  if (total > 100) return { label: "M", color: "border-sky-700 bg-sky-950/50 text-sky-200" };
  if (total > 30) return { label: "S", color: "border-emerald-700 bg-emerald-950/50 text-emerald-200" };
  return { label: "XS", color: "border-slate-600 bg-slate-900/50 text-slate-300" };
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

  const { aiMode } = useAiMode();

  const [priorityView, setPriorityView] = useState<PriorityView>("all");
  const [prioritySort, setPrioritySort] = useState<PrioritySort>("updatedDesc");
  const [search, setSearch] = useState("");

  const [detailsOpenFor, setDetailsOpenFor] = useState<number | null>(null);
  const [glanceByPr, setGlanceByPr] = useState<
    Record<number, { loading: boolean; markdown?: string; error?: string }>
  >({});
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
    async (targetPage: number, searchQuery?: string) => {
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
        if (searchQuery) q.set("search", searchQuery);
        const res = await fetch(`/api/prs?${q.toString()}`);
        const json = (await res.json()) as PrsResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }
        setData(json);
        if (!searchQuery) setPage(targetPage);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : "Failed to load PRs");
      } finally {
        setLoading(false);
      }
    },
    [canLoad, owner, repo, perPage, state],
  );

  useEffect(() => {
    const q = search.trim();
    if (!q || !canLoad) return;
    const timer = setTimeout(() => void fetchPrs(1, q), 400);
    return () => clearTimeout(timer);
  }, [search, canLoad, fetchPrs]);

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

  const runGlance = useCallback(
    async (number: number) => {
      if (!canLoad || !aiMode) return;
      setGlanceByPr((prev) => ({ ...prev, [number]: { loading: true } }));
      try {
        const res = await fetch("/api/glance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: owner.trim(), repo: repo.trim(), number }),
        });
        const json = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Glance failed (${res.status})`);
        setGlanceByPr((prev) => ({ ...prev, [number]: { loading: false, markdown: json.markdown ?? "" } }));
      } catch (e) {
        setGlanceByPr((prev) => ({
          ...prev,
          [number]: { loading: false, error: e instanceof Error ? e.message : "Failed to generate glance" },
        }));
      }
    },
    [aiMode, canLoad, owner, repo],
  );

  const runInsights = useCallback(
    async (number: number) => {
      if (!canLoad || !aiMode) return;
      setInsightsByPr((prev) => ({ ...prev, [number]: { loading: true } }));
      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: owner.trim(), repo: repo.trim(), number }),
        });
        const json = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? `Insights failed (${res.status})`);
        setInsightsByPr((prev) => ({ ...prev, [number]: { loading: false, markdown: json.markdown ?? "" } }));
      } catch (e) {
        setInsightsByPr((prev) => ({
          ...prev,
          [number]: { loading: false, error: e instanceof Error ? e.message : "Failed to generate insights" },
        }));
      }
    },
    [aiMode, canLoad, owner, repo],
  );

  useEffect(() => {
    if (!aiMode || detailsOpenFor === null) return;

    const gl = glanceByPr[detailsOpenFor];
    if (!gl?.loading && gl?.markdown === undefined && !gl?.error) {
      void runGlance(detailsOpenFor);
    }

    const ins = insightsByPr[detailsOpenFor];
    if (!ins?.loading && ins?.markdown === undefined && !ins?.error) {
      void runInsights(detailsOpenFor);
    }
  }, [aiMode, detailsOpenFor, glanceByPr, insightsByPr, runGlance, runInsights]);

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
      <section className="rounded-xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</span>
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              placeholder="e.g. acme-corp"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Repo</span>
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              placeholder="e.g. billing-service"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">State</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
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
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
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
            onClick={() => { setSearch(""); void fetchPrs(1); }}
          >
            Load PRs
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900"
                disabled={page <= 1 || loading}
                onClick={() => void fetchPrs(Math.max(1, page - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900"
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
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">Search</span>
                <div className="relative">
                  <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    className="rounded-md border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                    placeholder="PR # or title…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search ? (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      onClick={() => { setSearch(""); void fetchPrs(page); }}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">Priority view</span>
                <select
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
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
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">Sort</span>
                <select
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
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

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <thead className="bg-slate-100/80 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Review Ready</th>
                  <th className="px-3 py-2">Checks</th>
                  <th className="px-3 py-2">ACK</th>
                  <th className="px-3 py-2">Comments</th>
                  <th className="px-3 py-2">Mergeable</th>
                  <th className="px-3 py-2">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white/60 dark:divide-slate-800 dark:bg-slate-950/40">
                {pullsForTable.map((p) => {
                  const ack = summarizeReviews(p.reviews);
                  const ready = isReviewReady(p);
                  const expanded = detailsOpenFor === p.number;
                  const gl = glanceByPr[p.number];
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
                          <div className="mt-1 grid gap-0.5 text-[11px]">
                            {p.readiness.breakdown.draftPenalty > 0 && (
                              <div className="text-amber-300">−{p.readiness.breakdown.draftPenalty} draft</div>
                            )}
                            {p.readiness.breakdown.mergePenalty > 0 && (
                              <div className="text-rose-300">−{p.readiness.breakdown.mergePenalty} merge</div>
                            )}
                            {p.readiness.breakdown.reviewPenalty > 0 && (
                              <div className="text-rose-300">−{p.readiness.breakdown.reviewPenalty} review</div>
                            )}
                            {p.readiness.breakdown.checkPenalty > 0 && (
                              <div className="text-rose-300">−{p.readiness.breakdown.checkPenalty} checks</div>
                            )}
                            {p.readiness.breakdown.approvalBonus > 0 && (
                              <div className="text-emerald-300">+{p.readiness.breakdown.approvalBonus} approval</div>
                            )}
                            {p.readiness.breakdown.draftPenalty === 0 &&
                              p.readiness.breakdown.mergePenalty === 0 &&
                              p.readiness.breakdown.reviewPenalty === 0 &&
                              p.readiness.breakdown.checkPenalty === 0 &&
                              p.readiness.breakdown.approvalBonus === 0 && (
                              <div className="text-slate-500">no penalties</div>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-3">
                          {(() => {
                            const sz = prSize(p.additions, p.deletions);
                            return (
                              <div className="flex flex-col items-start gap-1">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${sz.color}`}>
                                  {sz.label}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  <span className="text-emerald-400">+{p.additions}</span>{" "}
                                  <span className="text-rose-400">−{p.deletions}</span>
                                </span>
                              </div>
                            );
                          })()}
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

                        <td className="px-3 py-3 text-xs">
                          {(() => {
                            const conflicted = p.mergeable === false || p.mergeable_state === "dirty";
                            const clean = p.mergeable === true && !conflicted;
                            const unknown = p.mergeable === null;
                            const tags: { label: string; cls: string }[] = [];
                            if (clean) tags.push({ label: "Clean", cls: "text-emerald-300" });
                            if (conflicted) tags.push({ label: "Conflict", cls: "text-rose-300" });
                            if (unknown) tags.push({ label: "Unknown", cls: "text-slate-400" });
                            if (p.draft) tags.push({ label: "Draft", cls: "text-amber-300" });
                            if (p.checks.failing > 0) tags.push({ label: "CI failing", cls: "text-rose-300" });
                            if (p.checks.pending > 0) tags.push({ label: "CI pending", cls: "text-amber-200" });
                            if (p.readiness.breakdown.changesRequested > 0) tags.push({ label: "Changes requested", cls: "text-rose-300" });
                            if (p.readiness.breakdown.approvals > 0) tags.push({ label: `${p.readiness.breakdown.approvals} approved`, cls: "text-emerald-300" });
                            return (
                              <div className="flex flex-col gap-0.5">
                                {tags.map((t, ti) => (
                                  <span key={ti} className={t.cls}>{t.label}</span>
                                ))}
                              </div>
                            );
                          })()}
                        </td>

                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900"
                            disabled={!aiMode || reviewLoading}
                            title={!aiMode ? "Enable AI mode to run AI review" : undefined}
                            onClick={() => void runReview(p.number)}
                          >
                            AI Review
                          </button>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-3">
                            <div className="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                              {/* Compact status bar */}
                              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                                <span className="font-medium text-slate-100">#{p.number}</span>
                                <span>
                                  Readiness{" "}
                                  <span className={ready ? "text-emerald-300" : "text-amber-200"}>{p.readiness.score}</span>
                                </span>
                                <span>
                                  Checks{" "}
                                  <span className="text-rose-300">{p.checks.failing}F</span>{" "}
                                  <span className="text-amber-200">{p.checks.pending}P</span>
                                </span>
                                <span>
                                  Approvals <span className="text-emerald-300">{p.readiness.breakdown.approvals}</span>
                                  {" · "}
                                  Changes requested <span className="text-rose-300">{p.readiness.breakdown.changesRequested}</span>
                                </span>
                                <span>
                                  Merge{" "}
                                  {p.mergeable === null ? "unknown" : p.mergeable ? (
                                    <span className="text-emerald-300">clean</span>
                                  ) : (
                                    <span className="text-rose-300">conflict</span>
                                  )}
                                </span>
                              </div>

                              {aiMode ? (
                                <div className="grid gap-3 md:grid-cols-2">
                                  {/* Left: At a glance */}
                                  <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                                    <div className="flex items-center justify-between gap-3">
                                      <h3 className="bg-gradient-to-r from-emerald-500 via-cyan-500 to-emerald-500 bg-clip-text text-sm font-bold uppercase tracking-wide text-transparent dark:from-emerald-400 dark:via-cyan-300 dark:to-emerald-400">
                                        At a glance
                                      </h3>
                                      {gl?.loading ? (
                                        <span className="text-xs text-slate-400">Generating…</span>
                                      ) : null}
                                    </div>

                                    {gl?.error ? (
                                      <p className="mt-2 rounded-md border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
                                        {gl.error}
                                      </p>
                                    ) : null}

                                    {gl?.markdown ? <GlanceView markdown={gl.markdown} /> : null}

                                    {!gl?.loading && !gl?.markdown && !gl?.error ? (
                                      <div className="mt-2">
                                        <button
                                          type="button"
                                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                          onClick={() => void runGlance(p.number)}
                                        >
                                          Generate glance
                                        </button>
                                        <p className="mt-1 text-[11px] text-slate-500">
                                          Key code changes from the diff.
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>

                                  {/* Right: Review Guide */}
                                  <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                                    <div className="flex items-center justify-between gap-3">
                                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                                        Review Guide
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

                                    {ins?.markdown ? <InsightsView markdown={ins.markdown} /> : null}

                                    {!ins?.loading && !ins?.markdown && !ins?.error ? (
                                      <div className="mt-2">
                                        <button
                                          type="button"
                                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                          onClick={() => void runInsights(p.number)}
                                        >
                                          Generate guide
                                        </button>
                                        <p className="mt-1 text-[11px] text-slate-500">
                                          Checklist, risks, and testing suggestions.
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
                                  Enable AI mode to generate glance and reviewer insights for this PR.
                                </div>
                              )}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center dark:bg-black/60">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
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
