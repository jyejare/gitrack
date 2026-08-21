"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAiMode } from "@/components/AiModeContext";
import { useMetrics } from "@/components/MetricsContext";
import {
    buildLlmHeaders,
    parseRepoInput,
    loadBookmarks,
    saveBookmark,
    removeBookmark,
    loadReviewRules,
    saveReviewRule,
    deleteReviewRule,
    loadReviewCommentHeading,
    type RepoBookmark,
    type SavedRule,
} from "@/lib/client-settings";

function getSessionHeaders(): Record<string, string> {
    return buildLlmHeaders();
}

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
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
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
  if (score >= 80) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 55) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

function prStatusBadge(p: PullRow): { label: string; cls: string } {
  if (p.draft)
    return { label: "Draft", cls: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300" };
  if (isConflicted(p))
    return { label: "Conflict", cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200" };
  if (p.checks.failing > 0)
    return { label: "CI Failing", cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200" };
  if (p.readiness.breakdown.changesRequested > 0)
    return { label: "Changes Requested", cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" };
  if (isReviewReady(p))
    return { label: "Ready", cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" };
  return { label: "Not Ready", cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" };
}

/* ── Walkthrough types (from glance API) ─────────────────────────────── */

type WalkthroughEntry = { file: string; change: string; summary: string; code?: string };

type GlanceData = {
  loading: boolean;
  summary?: string;
  walkthrough?: WalkthroughEntry[];
  markdown?: string;
  error?: string;
};

/* ── Review types (from review API) ──────────────────────────────────── */

type ReviewCommentData = {
  file: string;
  line?: string;
  severity: string;
  title: string;
  body: string;
  existing_code?: string;
  suggested_code?: string;
};

type ReviewData = {
  summary?: string;
  verdict?: string;
  comments?: ReviewCommentData[];
  markdown?: string;
  model?: string;
};

/* ── Repo rules types ────────────────────────────────────────────────── */

type RepoRuleFile = { path: string; content: string };
type RepoRulesData = {
    cursor: RepoRuleFile[];
    claude: RepoRuleFile[];
};

/* ── Change type badge ───────────────────────────────────────────────── */

const CHANGE_BADGE: Record<string, string> = {
  Added: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  Removed: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200",
  Renamed: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200",
  Modified: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
};

/* ── Severity badge ──────────────────────────────────────────────────── */

const SEVERITY_CONFIG: Record<string, { label: string; cls: string; icon: string }> = {
  critical: {
    label: "Critical",
    cls: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200",
    icon: "!!!",
  },
  warning: {
    label: "Warning",
    cls: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
    icon: "!!",
  },
  suggestion: {
    label: "Suggestion",
    cls: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
    icon: "!",
  },
  nitpick: {
    label: "Nitpick",
    cls: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300",
    icon: "~",
  },
  praise: {
    label: "Praise",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
    icon: "+",
  },
};

const VERDICT_CONFIG: Record<string, { label: string; cls: string }> = {
  approve: {
    label: "Approve",
    cls: "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
  "request-changes": {
    label: "Changes Requested",
    cls: "border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-200",
  },
  comment: {
    label: "Comment",
    cls: "border-sky-400 bg-sky-50 text-sky-800 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200",
  },
};

/* ── Code helpers ────────────────────────────────────────────────────── */

function normalizeCodeNewlines(code: string): string {
  if (!code.includes("\n") && code.includes("\\n")) {
    return code.replace(/\\n/g, "\n");
  }
  return code;
}

function DiffLines({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-slate-700/50 bg-slate-950 p-2 text-[11px] leading-relaxed">
      {lines.map((line, j) => (
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
  );
}

/* ── Shared Markdown renderer (react-markdown + remark-gfm) ─────────── */

const mdComponents: Record<string, React.ComponentType<Record<string, unknown>>> = {
  h1: (props: Record<string, unknown>) => <h1 className="mt-4 first:mt-0 text-base font-bold text-slate-900 dark:text-slate-100" {...props} />,
  h2: (props: Record<string, unknown>) => <h2 className="mt-4 first:mt-0 text-base font-semibold text-slate-900 dark:text-slate-100" {...props} />,
  h3: (props: Record<string, unknown>) => <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100" {...props} />,
  h4: (props: Record<string, unknown>) => <h4 className="mt-2 text-xs font-semibold text-slate-900 dark:text-slate-100" {...props} />,
  p: (props: Record<string, unknown>) => <p className="my-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300" {...props} />,
  ul: (props: Record<string, unknown>) => <ul className="my-1.5 ml-4 list-disc text-sm text-slate-700 dark:text-slate-300" {...props} />,
  ol: (props: Record<string, unknown>) => <ol className="my-1.5 ml-4 list-decimal text-sm text-slate-700 dark:text-slate-300" {...props} />,
  li: (props: Record<string, unknown>) => <li className="my-0.5 leading-relaxed" {...props} />,
  hr: (props: Record<string, unknown>) => <hr className="my-3 border-slate-300 dark:border-slate-700" {...props} />,
  blockquote: (props: Record<string, unknown>) => <blockquote className="my-2 border-l-2 border-slate-400 pl-3 text-sm italic text-slate-500 dark:border-slate-600 dark:text-slate-400" {...props} />,
  a: (props: Record<string, unknown>) => <a className="text-emerald-600 underline hover:text-emerald-500 dark:text-emerald-400" target="_blank" rel="noopener noreferrer" {...props} />,
  strong: (props: Record<string, unknown>) => <strong className="font-semibold text-slate-900 dark:text-slate-100" {...props} />,
  table: (props: Record<string, unknown>) => <div className="my-2 overflow-x-auto"><table className="min-w-full text-xs border-collapse" {...props} /></div>,
  th: (props: Record<string, unknown>) => <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-700 dark:bg-slate-800" {...props} />,
  td: (props: Record<string, unknown>) => <td className="border border-slate-300 px-2 py-1 dark:border-slate-700" {...props} />,
  code: ({ className, children, ...rest }: Record<string, unknown>) => {
    const isBlock = typeof className === "string" && /language-/.test(className);
    if (isBlock) {
      const text = String(children ?? "").replace(/\n$/, "");
      return (
        <pre className="my-2 overflow-x-auto rounded-md border border-slate-700/50 bg-slate-950 p-2 text-[11px] leading-relaxed">
          {text.split("\n").map((line, i) => (
            <div
              key={i}
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
      <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-cyan-700 dark:bg-slate-800 dark:text-cyan-300" {...rest}>
        {children as React.ReactNode}
      </code>
    );
  },
  pre: ({ children }: Record<string, unknown>) => <>{children}</>,
};

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="max-w-none text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ── At a Glance View (numbered cards with code) ─────────────────────── */

function GlanceView({ summary, walkthrough }: { summary: string; walkthrough: WalkthroughEntry[] }) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      {summary ? (
        <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-700/50 dark:bg-slate-900/40">
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p>
        </div>
      ) : null}

      {walkthrough.map((entry, i) => (
        <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="flex-none rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <code className="text-xs font-semibold text-cyan-300">{entry.file}</code>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${CHANGE_BADGE[entry.change] ?? CHANGE_BADGE.Modified}`}>
              {entry.change}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{entry.summary}</p>
          {entry.code ? <DiffLines code={entry.code} /> : null}
        </div>
      ))}
    </div>
  );
}

/* ── Markdown fallback for glance ────────────────────────────────────── */

function GlanceFallback({ markdown }: { markdown: string }) {
  return (
    <div className="mt-2">
      <MarkdownBody text={markdown} />
    </div>
  );
}

/* ── Structured Review View (editable, CodeRabbit-style) ─────────────── */

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "suggestion", label: "Suggestion" },
  { value: "nitpick", label: "Nitpick" },
  { value: "praise", label: "Praise" },
];

const VERDICT_OPTIONS: { value: string; label: string }[] = [
  { value: "approve", label: "Approve" },
  { value: "request-changes", label: "Changes Requested" },
  { value: "comment", label: "Comment" },
];

function ReviewCommentsView({
  summary,
  verdict,
  comments,
  includeCommentHeading,
  onUpdateSummary,
  onUpdateVerdict,
  onUpdateComment,
  onDeleteComment,
  onAddComment,
}: {
  summary: string;
  verdict: string;
  comments: ReviewCommentData[];
  includeCommentHeading: boolean;
  onUpdateSummary: (s: string) => void;
  onUpdateVerdict: (v: string) => void;
  onUpdateComment: (index: number, c: ReviewCommentData) => void;
  onDeleteComment: (index: number) => void;
  onAddComment: (c: ReviewCommentData) => void;
}) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ReviewCommentData | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [addDraft, setAddDraft] = useState<ReviewCommentData>({
    file: "", severity: "suggestion", title: "", body: "",
  });

  const toggleFileGroup = (file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const globalIdx = (file: string, localIdx: number): number => {
    let count = 0;
    for (const c of comments) {
      if (c.file === file) {
        if (count === localIdx) return comments.indexOf(c);
        count++;
      }
    }
    return -1;
  };

  const fileGroups = useMemo(() => {
    const groups = new Map<string, ReviewCommentData[]>();
    for (const c of comments) {
      const existing = groups.get(c.file) ?? [];
      existing.push(c);
      groups.set(c.file, existing);
    }
    return Array.from(groups.entries());
  }, [comments]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of comments) {
      counts[c.severity] = (counts[c.severity] ?? 0) + 1;
    }
    return counts;
  }, [comments]);

  const vCfg = VERDICT_CONFIG[verdict] ?? VERDICT_CONFIG.comment;

  const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950";
  const textareaCls = `${inputCls} resize-y`;
  const btnSmCls = "rounded px-2 py-0.5 text-[11px] font-medium";

  return (
    <div className="flex flex-col gap-4">
      {/* Summary + verdict header */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Summary</h3>
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
              value={verdict}
              onChange={(e) => onUpdateVerdict(e.target.value)}
            >
              {VERDICT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {editingSummary ? (
          <div className="flex flex-col gap-2">
            <textarea className={textareaCls} rows={3} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className={`${btnSmCls} bg-emerald-600 text-white hover:bg-emerald-500`} onClick={() => { onUpdateSummary(summaryDraft); setEditingSummary(false); }}>Save</button>
              <button type="button" className={`${btnSmCls} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900`} onClick={() => setEditingSummary(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <MarkdownBody text={summary} />
            </div>
            <button
              type="button"
              className="mt-1 text-[11px] text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"
              onClick={() => { setSummaryDraft(summary); setEditingSummary(true); }}
            >
              Edit summary
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-700/50">
          {Object.entries(severityCounts).map(([sev, count]) => {
            const cfg = SEVERITY_CONFIG[sev] ?? SEVERITY_CONFIG.suggestion;
            return (
              <span key={sev} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.cls}`}>
                {cfg.label}: {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* File-grouped comments */}
      {fileGroups.map(([file, fileComments]) => {
        const isCollapsed = collapsedFiles.has(file);
        return (
          <div key={file} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700/50">
            <button
              type="button"
              className="flex w-full items-center gap-2 bg-slate-100/80 px-3 py-2 text-left hover:bg-slate-200/60 dark:bg-slate-900/60 dark:hover:bg-slate-800/60"
              onClick={() => toggleFileGroup(file)}
            >
              <span
                className="inline-block text-[10px] text-slate-400 transition-transform"
                style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }}
              >
                ▶
              </span>
              <code className="text-xs font-semibold text-slate-800 dark:text-slate-200">{file}</code>
              <span className="text-[11px] text-slate-500">({fileComments.length})</span>
            </button>
            {!isCollapsed ? (
              <div className="divide-y divide-slate-100 bg-white/60 dark:divide-slate-800 dark:bg-slate-950/40">
                {fileComments.map((c, ci) => {
                  const gIdx = globalIdx(file, ci);
                  const isEditing = editingIdx === gIdx;
                  const sCfg = SEVERITY_CONFIG[c.severity] ?? SEVERITY_CONFIG.suggestion;

                  if (isEditing && editDraft) {
                    return (
                      <div key={ci} className="flex flex-col gap-2 bg-slate-50 px-3 py-3 dark:bg-slate-900/30">
                        <div className={`grid gap-2 ${includeCommentHeading ? "grid-cols-3" : "grid-cols-1"}`}>
                          <select className={inputCls} value={editDraft.severity} onChange={(e) => setEditDraft({ ...editDraft, severity: e.target.value })}>
                            {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {includeCommentHeading ? (
                            <input className={`${inputCls} col-span-2`} placeholder="Title" value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                          ) : null}
                        </div>
                        <textarea className={textareaCls} rows={3} placeholder="Comment body" value={editDraft.body} onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                          <textarea className={textareaCls} rows={2} placeholder="Existing code (optional)" value={editDraft.existing_code ?? ""} onChange={(e) => setEditDraft({ ...editDraft, existing_code: e.target.value || undefined })} />
                          <textarea className={textareaCls} rows={2} placeholder="Suggested code (optional)" value={editDraft.suggested_code ?? ""} onChange={(e) => setEditDraft({ ...editDraft, suggested_code: e.target.value || undefined })} />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className={`${btnSmCls} bg-emerald-600 text-white hover:bg-emerald-500`} onClick={() => { onUpdateComment(gIdx, editDraft); setEditingIdx(null); setEditDraft(null); }}>Save</button>
                          <button type="button" className={`${btnSmCls} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900`} onClick={() => { setEditingIdx(null); setEditDraft(null); }}>Cancel</button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={ci} className="px-3 py-3">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 inline-flex flex-none items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sCfg.cls}`}>
                          {sCfg.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                              {includeCommentHeading ? (
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{c.title}</span>
                              ) : null}
                              {c.line ? <span className="text-[11px] text-slate-500">L{c.line}</span> : null}
                            </div>
                            <div className="flex flex-none items-center gap-1">
                              <button
                                type="button"
                                className="text-[11px] text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                                onClick={() => { setEditingIdx(gIdx); setEditDraft({ ...c }); }}
                              >
                                Edit
                              </button>
                              <span className="text-slate-300 dark:text-slate-700">|</span>
                              <button
                                type="button"
                                className="text-[11px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                                onClick={() => onDeleteComment(gIdx)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            <MarkdownBody text={c.body} />
                          </div>
                          {c.existing_code ? (
                            <div className="mt-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Current code</div>
                                <button
                                  type="button"
                                  className="text-[11px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                                  onClick={() => onUpdateComment(gIdx, { ...c, existing_code: undefined })}
                                >
                                  Remove
                                </button>
                              </div>
                              <DiffLines code={normalizeCodeNewlines(c.existing_code)} />
                            </div>
                          ) : null}
                          {c.suggested_code ? (
                            <div className="mt-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Suggested replacement</div>
                                <button
                                  type="button"
                                  className="text-[11px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                                  onClick={() => onUpdateComment(gIdx, { ...c, suggested_code: undefined })}
                                >
                                  Remove
                                </button>
                              </div>
                              <DiffLines code={normalizeCodeNewlines(c.suggested_code)} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Add comment form */}
      {addingComment ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-emerald-400 bg-emerald-50/30 p-3 dark:border-emerald-700 dark:bg-emerald-950/20">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Add comment</div>
          <div className={`grid gap-2 ${includeCommentHeading ? "grid-cols-4" : "grid-cols-2"}`}>
            <input className={inputCls} placeholder="File path" value={addDraft.file} onChange={(e) => setAddDraft({ ...addDraft, file: e.target.value })} />
            <select className={inputCls} value={addDraft.severity} onChange={(e) => setAddDraft({ ...addDraft, severity: e.target.value })}>
              {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {includeCommentHeading ? (
              <input className={`${inputCls} col-span-2`} placeholder="Title" value={addDraft.title} onChange={(e) => setAddDraft({ ...addDraft, title: e.target.value })} />
            ) : null}
          </div>
          <textarea className={textareaCls} rows={3} placeholder="Comment body" value={addDraft.body} onChange={(e) => setAddDraft({ ...addDraft, body: e.target.value })} />
          <div className="flex gap-2">
            <button
              type="button"
              className={`${btnSmCls} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40`}
              disabled={!addDraft.file.trim() || !addDraft.body.trim() || (includeCommentHeading && !addDraft.title.trim())}
              onClick={() => {
                onAddComment(addDraft);
                setAddDraft({ file: "", severity: "suggestion", title: "", body: "" });
                setAddingComment(false);
              }}
            >
              Add
            </button>
            <button type="button" className={`${btnSmCls} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900`} onClick={() => setAddingComment(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 self-start rounded-md border border-dashed border-slate-400 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-emerald-500 hover:text-emerald-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
          onClick={() => setAddingComment(true)}
        >
          + Add comment
        </button>
      )}
    </div>
  );
}

/* ── Markdown fallback for review ────────────────────────────────────── */

function ReviewFallback({ markdown }: { markdown: string }) {
  return <MarkdownBody text={markdown} />;
}

/* ── Insights / Review Guide renderer ────────────────────────────────── */

const SECTION_THEMES = [
  { border: "border-sky-800/50 bg-sky-950/25", heading: "text-sky-300" },
  { border: "border-amber-800/50 bg-amber-950/25", heading: "text-amber-300" },
  { border: "border-violet-800/50 bg-violet-950/25", heading: "text-violet-300" },
  { border: "border-teal-800/50 bg-teal-950/25", heading: "text-teal-300" },
];

function InsightsView({ markdown }: { markdown: string }) {
  const sections = useMemo(() => {
    const parts = markdown.split(/^(?=#{1,4}\s+|\*\*[^*]+\*\*\s*$)/m).filter((s) => s.trim());
    return parts.map((part) => {
      const lines = part.split("\n");
      const isHeading = /^(#{1,4}\s+|\*\*[^*]+\*\*\s*$)/.test(lines[0]);
      const heading = lines[0]
        .replace(/^#{1,4}\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/^["]+|["]+$/g, "")
        .trim();
      const content = lines.slice(isHeading ? 1 : 0).join("\n").trim();
      return { heading: isHeading ? heading : "", content: isHeading ? content : part.trim() };
    });
  }, [markdown]);

  if (sections.length === 0) {
    return (
      <div className="mt-2">
        <MarkdownBody text={markdown} />
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {sections.map((sec, i) => {
        const theme = SECTION_THEMES[i % SECTION_THEMES.length];
        return (
          <div key={i} className={`rounded-lg border p-3 ${theme.border}`}>
            {sec.heading ? (
              <h4 className={`text-xs font-semibold uppercase tracking-wide ${theme.heading}`}>
                {sec.heading}
              </h4>
            ) : null}
            {sec.content ? (
              <div className="mt-2">
                <MarkdownBody text={sec.content} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ── Time-ago helper ────────────────────────────────────────────────── */

function timeAgo(iso: string | null): { text: string; title: string } {
  if (!iso) return { text: "—", title: "No activity" };
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return { text: "just now", title: new Date(iso).toLocaleString() };
  const min = Math.floor(sec / 60);
  if (min < 60) return { text: `${min}m ago`, title: new Date(iso).toLocaleString() };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { text: `${hr}h ago`, title: new Date(iso).toLocaleString() };
  const days = Math.floor(hr / 24);
  if (days < 30) return { text: `${days}d ago`, title: new Date(iso).toLocaleString() };
  const months = Math.floor(days / 30);
  if (months < 12) return { text: `${months}mo ago`, title: new Date(iso).toLocaleString() };
  const years = Math.floor(months / 12);
  return { text: `${years}y ago`, title: new Date(iso).toLocaleString() };
}

function ageBadgeColor(iso: string): string {
  const days = (Date.now() - Date.parse(iso)) / (1000 * 60 * 60 * 24);
  if (days > 30) return "text-rose-700 dark:text-rose-300";
  if (days > 14) return "text-amber-700 dark:text-amber-300";
  if (days > 7) return "text-yellow-700 dark:text-yellow-200";
  return "text-emerald-700 dark:text-emerald-300";
}

/* ── PR size helper ──────────────────────────────────────────────────── */

type PrSize = { label: string; color: string };

function prSize(additions: number, deletions: number): PrSize {
  const total = additions + deletions;
  if (total > 10000) return { label: "XXL", color: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-200" };
  if (total > 5000) return { label: "XL", color: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-200" };
  if (total > 1000) return { label: "L", color: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200" };
  if (total > 500) return { label: "M", color: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200" };
  if (total > 100) return { label: "S", color: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200" };
  return { label: "XS", color: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300" };
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

// ---------- Metrics Panel ----------

type MetricsData = {
  period: { days: number; since: string };
  counts: { totalOpen: number; mergedInPeriod: number; closedInPeriod: number; createdInPeriod: number };
  averages: { mergeTimeHours: number; openAgeDays: number };
  throughput: Array<{ week: string; opened: number; merged: number }>;
  sizeDistribution: Array<{ size: string; count: number }>;
};

function MetricsPanel({ owner, repo }: { owner: string; repo: string }) {
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchMetrics = useCallback(async () => {
    if (!owner || !repo) return;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const res = await fetch(`/api/metrics?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&days=${days}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed to load metrics (${res.status})`);
      setMetricsData(json as MetricsData);
    } catch (e) {
      setMetricsError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setMetricsLoading(false);
    }
  }, [owner, repo, days]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  if (metricsLoading) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-6 text-center dark:border-violet-800/60 dark:bg-violet-950/20">
        <p className="text-sm text-slate-500">Loading metrics…</p>
      </div>
    );
  }

  if (metricsError) {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
        <p className="text-sm text-rose-800 dark:text-rose-200">{metricsError}</p>
        <button type="button" className="mt-2 text-xs font-medium text-rose-600 underline hover:text-rose-500" onClick={() => void fetchMetrics()}>Retry</button>
      </div>
    );
  }

  if (!metricsData) return null;

  const d = metricsData;
  const maxThroughput = Math.max(...d.throughput.flatMap((w) => [w.opened, w.merged]), 1);
  const totalSize = d.sizeDistribution.reduce((s, b) => s + b.count, 0) || 1;

  const cards = [
    { label: "Open PRs", value: String(d.counts.totalOpen), tone: "text-slate-900 dark:text-slate-100" },
    { label: `Created (${days}d)`, value: String(d.counts.createdInPeriod), tone: "text-blue-700 dark:text-blue-300" },
    { label: `Merged (${days}d)`, value: String(d.counts.mergedInPeriod), tone: "text-emerald-700 dark:text-emerald-300" },
    { label: "Avg Merge Time", value: d.averages.mergeTimeHours < 24 ? `${d.averages.mergeTimeHours}h` : `${Math.round(d.averages.mergeTimeHours / 24)}d`, tone: "text-violet-700 dark:text-violet-300" },
    { label: "Avg Open Age", value: `${d.averages.openAgeDays}d`, tone: d.averages.openAgeDays > 14 ? "text-amber-700 dark:text-amber-300" : "text-slate-700 dark:text-slate-300" },
  ];

  const SIZE_COLORS: Record<string, string> = {
    XS: "bg-emerald-500",
    S: "bg-green-500",
    M: "bg-amber-500",
    L: "bg-orange-500",
    XL: "bg-rose-500",
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-violet-200 bg-violet-50/20 p-4 dark:border-violet-800/50 dark:bg-violet-950/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">Repository Metrics</h3>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-violet-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <button type="button" className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400" onClick={() => void fetchMetrics()}>Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="flex flex-col items-center rounded-xl border border-slate-200 bg-white/80 px-3 py-4 dark:border-slate-800 dark:bg-slate-900/50">
            <span className={`text-2xl font-bold ${c.tone}`}>{c.value}</span>
            <span className="mt-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Throughput chart */}
        <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Weekly Throughput</h4>
          {d.throughput.length > 0 ? (
            <div className="flex items-end gap-1" style={{ height: 100 }}>
              {d.throughput.map((w) => (
                <div key={w.week} className="flex flex-1 flex-col items-center gap-0.5">
                  <div className="flex w-full items-end justify-center gap-px" style={{ height: 80 }}>
                    <div className="w-2 rounded-t bg-blue-400 dark:bg-blue-500" style={{ height: `${(w.opened / maxThroughput) * 100}%`, minHeight: w.opened > 0 ? 4 : 0 }} title={`Opened: ${w.opened}`} />
                    <div className="w-2 rounded-t bg-emerald-400 dark:bg-emerald-500" style={{ height: `${(w.merged / maxThroughput) * 100}%`, minHeight: w.merged > 0 ? 4 : 0 }} title={`Merged: ${w.merged}`} />
                  </div>
                  <span className="text-[8px] text-slate-400">{w.week.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-slate-400">No data</p>}
          <div className="mt-2 flex items-center gap-3 text-[9px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-400" /> Opened</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" /> Merged</span>
          </div>
        </div>

        {/* Size distribution */}
        <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">PR Size Distribution</h4>
          <div className="flex flex-col gap-1.5">
            {d.sizeDistribution.map((b) => (
              <div key={b.size} className="flex items-center gap-2">
                <span className="w-8 text-xs font-semibold text-slate-600 dark:text-slate-400">{b.size}</span>
                <div className="flex-1">
                  <div className="h-3 rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className={`h-3 rounded-full ${SIZE_COLORS[b.size] ?? "bg-slate-400"}`} style={{ width: `${(b.count / totalSize) * 100}%` }} />
                  </div>
                </div>
                <span className="w-10 text-right text-[10px] text-slate-500">{b.count} ({Math.round((b.count / totalSize) * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------

export function Dashboard() {
  const [repoInput, setRepoInput] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const { aiMode } = useAiMode();
  const { metrics: metricsMode } = useMetrics();

  const [bookmarks, setBookmarks] = useState<RepoBookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const bookmarkMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setBookmarks(loadBookmarks()); }, []);

  useEffect(() => {
    if (!showBookmarks) return;
    function handleClick(e: MouseEvent) {
      if (bookmarkMenuRef.current && !bookmarkMenuRef.current.contains(e.target as Node)) {
        setShowBookmarks(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBookmarks]);

  const isBookmarked = useMemo(
    () => owner && repo && bookmarks.some(
      (b) => b.owner.toLowerCase() === owner.toLowerCase() && b.repo.toLowerCase() === repo.toLowerCase(),
    ),
    [bookmarks, owner, repo],
  );

  const applyRepoInput = useCallback((input: string) => {
    const parsed = parseRepoInput(input);
    if (parsed) {
      setOwner(parsed.owner);
      setRepo(parsed.repo);
      setRepoInput(`${parsed.owner}/${parsed.repo}`);
      return true;
    }
    return false;
  }, []);

  const handleToggleBookmark = useCallback(() => {
    if (!owner || !repo) return;
    if (isBookmarked) {
      setBookmarks(removeBookmark(owner, repo));
    } else {
      setBookmarks(saveBookmark(owner, repo));
    }
  }, [owner, repo, isBookmarked]);

  const handleSelectBookmark = useCallback((b: RepoBookmark) => {
    setOwner(b.owner);
    setRepo(b.repo);
    setRepoInput(`${b.owner}/${b.repo}`);
    setShowBookmarks(false);
  }, []);

  const [priorityView, setPriorityView] = useState<PriorityView>("all");
  const [prioritySort, setPrioritySort] = useState<PrioritySort>("updatedDesc");
  const [search, setSearch] = useState("");
  const [reviewerFilter, setReviewerFilter] = useState("");

  const [detailsOpenFor, setDetailsOpenFor] = useState<number | null>(null);
  const [glanceByPr, setGlanceByPr] = useState<Record<number, GlanceData>>({});
  const [insightsByPr, setInsightsByPr] = useState<
    Record<number, { loading: boolean; markdown?: string; error?: string }>
  >({});

  const [data, setData] = useState<PrsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reviewOpenFor, setReviewOpenFor] = useState<number | null>(null);
  const [reviewLoadingFor, setReviewLoadingFor] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [includeCommentHeading, setIncludeCommentHeading] = useState(true);
  const [reviewPrompt, setReviewPrompt] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);

  useEffect(() => { setIncludeCommentHeading(loadReviewCommentHeading()); }, []);
  useEffect(() => {
    if (reviewOpenFor !== null) setIncludeCommentHeading(loadReviewCommentHeading());
  }, [reviewOpenFor]);

  const [assignedReviewers, setAssignedReviewers] = useState<Record<number, string[]>>({});
  const [teamMembers, setTeamMembers] = useState<Record<string, { login: string; avatar_url: string }>>({});

  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [savingRule, setSavingRule] = useState(false);
  const [saveRuleName, setSaveRuleName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const [repoRules, setRepoRules] = useState<RepoRulesData | null>(null);
  const [repoRulesLoading, setRepoRulesLoading] = useState(false);
  const [repoRulesError, setRepoRulesError] = useState<string | null>(null);
  const [selectedRulePaths, setSelectedRulePaths] = useState<Set<string>>(new Set());
  const [showRepoRules, setShowRepoRules] = useState(false);

  const canLoad = owner.trim() && repo.trim();

  useEffect(() => {
    if (!aiMode) {
      setDetailsOpenFor(null);
      setReviewOpenFor(null);
      setReviewData(null);
      setReviewError(null);
    }
  }, [aiMode]);

  const refreshSavedRules = useCallback(() => {
    if (!canLoad) return;
    setSavedRules(loadReviewRules(owner.trim(), repo.trim()));
  }, [canLoad, owner, repo]);

  const handleSaveRule = () => {
    if (!canLoad || !saveRuleName.trim() || !reviewPrompt.trim()) return;
    setSavingRule(true);
    const updated = saveReviewRule(owner.trim(), repo.trim(), saveRuleName.trim(), reviewPrompt.trim());
    setSavedRules(updated);
    setShowSaveInput(false);
    setSaveRuleName("");
    setSavingRule(false);
  };

  const handleDeleteRule = (name: string) => {
    if (!canLoad) return;
    const updated = deleteReviewRule(owner.trim(), repo.trim(), name);
    setSavedRules(updated);
  };

  const fetchRepoRulesFromGH = useCallback(async () => {
    if (!canLoad) return;
    setRepoRulesLoading(true);
    setRepoRulesError(null);
    try {
      const res = await fetch(
        `/api/repo-rules?owner=${encodeURIComponent(owner.trim())}&repo=${encodeURIComponent(repo.trim())}`,
        { headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `Failed to fetch repo rules (${res.status})`);
      }
      const json = (await res.json()) as { rules: RepoRulesData };
      setRepoRules(json.rules);
    } catch (e) {
      setRepoRulesError(e instanceof Error ? e.message : "Failed to fetch repo rules");
      setRepoRules(null);
    } finally {
      setRepoRulesLoading(false);
    }
  }, [canLoad, owner, repo]);

  const allRuleFiles = useMemo(() => {
    if (!repoRules) return [];
    return [
      ...repoRules.cursor.map((r) => ({ ...r, source: "cursor" as const })),
      ...repoRules.claude.map((r) => ({ ...r, source: "claude" as const })),
    ];
  }, [repoRules]);

  const selectedRulesText = useMemo(() => {
    if (selectedRulePaths.size === 0) return "";
    const sections: string[] = [];
    for (const rf of allRuleFiles) {
      if (selectedRulePaths.has(rf.path)) {
        sections.push(`── ${rf.path} ──\n${rf.content}`);
      }
    }
    return sections.join("\n\n");
  }, [allRuleFiles, selectedRulePaths]);

  const toggleRulePath = useCallback((path: string) => {
    setSelectedRulePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleAllRules = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedRulePaths(new Set(allRuleFiles.map((r) => r.path)));
    } else {
      setSelectedRulePaths(new Set());
    }
  }, [allRuleFiles]);

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
        const res = await fetch(`/api/prs?${q.toString()}`, { headers: getSessionHeaders() });
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
    if (data && canLoad) {
      refreshSavedRules();
      void fetchRepoRulesFromGH();
    }
  }, [data, canLoad, refreshSavedRules, fetchRepoRulesFromGH]);

  useEffect(() => {
    const q = search.trim();
    if (!q || !canLoad) return;
    setReviewerFilter("");
    const timer = setTimeout(() => void fetchPrs(1, q), 400);
    return () => clearTimeout(timer);
  }, [search, canLoad, fetchPrs]);

  const fetchAssignments = useCallback(async (pulls: PullRow[]) => {
    if (!canLoad || pulls.length === 0) return;
    try {
      const res = await fetch("/api/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
          pulls: pulls.map((p) => ({
            number: p.number,
            title: p.title,
            author: p.author,
            additions: p.additions,
            deletions: p.deletions,
          })),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { assignments: Record<number, string[]> };
        setAssignedReviewers(json.assignments ?? {});
      }
    } catch {
      // Best-effort; don't block the UI
    }
  }, [canLoad, owner, repo]);

  const fetchTeamMembers = useCallback(async () => {
    if (!canLoad) return;
    try {
      const res = await fetch(`/api/team?owner=${encodeURIComponent(owner.trim())}&repo=${encodeURIComponent(repo.trim())}`);
      if (res.ok) {
        const json = (await res.json()) as { team: { login: string; avatar_url: string }[] };
        const map: Record<string, { login: string; avatar_url: string }> = {};
        for (const m of json.team) map[m.login] = m;
        setTeamMembers(map);
      }
    } catch {
      // Best-effort
    }
  }, [canLoad, owner, repo]);

  useEffect(() => {
    if (data?.pulls && canLoad) {
      void fetchAssignments(data.pulls);
      void fetchTeamMembers();
    }
  }, [data, canLoad, fetchAssignments, fetchTeamMembers]);

  const runReview = async (number: number) => {
    if (!canLoad || !aiMode) return;
    setReviewOpenFor(number);
    setReviewLoadingFor(number);
    setReviewError(null);
    setReviewData(null);
    setSubmitResult(null);
    try {
      const payload: Record<string, unknown> = { owner: owner.trim(), repo: repo.trim(), number };
      if (reviewPrompt.trim()) payload.customPrompt = reviewPrompt.trim();
      if (selectedRulesText) payload.repoRulesContext = selectedRulesText;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json", ...getSessionHeaders() },
        body: JSON.stringify(payload),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Failed to get review response (${res.status}) — server returned non-JSON (possible timeout)`);
      }
      const json = (await res.json()) as {
        summary?: string;
        verdict?: string;
        comments?: ReviewCommentData[];
        markdown?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `Review failed (${res.status})`);
      }
      setReviewData({
        summary: json.summary,
        verdict: json.verdict,
        comments: json.comments,
        markdown: json.markdown,
        model: json.model,
      });
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setReviewLoadingFor(null);
    }
  };

  const submitReviewToPr = async () => {
    if (!reviewOpenFor || !reviewData?.comments?.length) return;
    setSubmitLoading(true);
    setSubmitResult(null);
    try {
      const res = await fetch("/api/review/submit", {
        method: "POST",
        headers: { "content-type": "application/json", ...getSessionHeaders() },
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
          number: reviewOpenFor,
          summary: reviewData.summary,
          verdict: reviewData.verdict,
          comments: reviewData.comments,
          includeCommentHeading,
        }),
      });
      const json = (await res.json()) as { success?: boolean; url?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `Failed to submit review (${res.status})`);
      }
      setSubmitResult({ success: true, url: json.url });
    } catch (e) {
      setSubmitResult({ success: false, error: e instanceof Error ? e.message : "Failed to submit review" });
    } finally {
      setSubmitLoading(false);
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
          headers: { "content-type": "application/json", ...getSessionHeaders() },
          body: JSON.stringify({ owner: owner.trim(), repo: repo.trim(), number }),
        });
        const json = (await res.json()) as {
          summary?: string;
          walkthrough?: WalkthroughEntry[];
          markdown?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `Glance failed (${res.status})`);
        setGlanceByPr((prev) => ({
          ...prev,
          [number]: {
            loading: false,
            summary: json.summary,
            walkthrough: json.walkthrough,
            markdown: json.markdown,
          },
        }));
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
          headers: { "content-type": "application/json", ...getSessionHeaders() },
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
    const glHasData = gl?.summary || gl?.walkthrough?.length || gl?.markdown;
    if (!gl?.loading && !glHasData && !gl?.error) {
      void runGlance(detailsOpenFor);
    }

    const ins = insightsByPr[detailsOpenFor];
    if (!ins?.loading && ins?.markdown === undefined && !ins?.error) {
      void runInsights(detailsOpenFor);
    }
  }, [aiMode, detailsOpenFor, glanceByPr, insightsByPr, runGlance, runInsights]);

  const availableReviewers = useMemo(() => {
    const set = new Set<string>();
    for (const logins of Object.values(assignedReviewers)) {
      for (const login of logins) set.add(login);
    }
    return Array.from(set).sort();
  }, [assignedReviewers]);

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

    if (reviewerFilter) {
      out = out.filter((p) => assignedReviewers[p.number]?.includes(reviewerFilter));
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
  }, [data, prioritySort, priorityView, reviewerFilter, assignedReviewers]);

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
          <div className="relative flex flex-col gap-1 md:col-span-4">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Repository</span>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                  placeholder="e.g. https://github.com/acme-corp/billing-service or acme-corp/billing-service"
                  value={repoInput}
                  onChange={(e) => {
                    setRepoInput(e.target.value);
                    const parsed = parseRepoInput(e.target.value);
                    if (parsed) { setOwner(parsed.owner); setRepo(parsed.repo); }
                    else { setOwner(""); setRepo(""); }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canLoad) { setSearch(""); void fetchPrs(1); }
                  }}
                />
                {owner && repo && (
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {owner}/{repo}
                  </span>
                )}
              </div>
              <button
                type="button"
                title={isBookmarked ? "Remove bookmark" : "Bookmark this repo"}
                disabled={!owner || !repo}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                onClick={handleToggleBookmark}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isBookmarked ? "text-amber-500" : "text-slate-400"}>
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <div className="relative" ref={bookmarkMenuRef}>
                <button
                  type="button"
                  title="Saved repos"
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                  onClick={() => setShowBookmarks((v) => !v)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
                {showBookmarks && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Saved Repositories</p>
                    </div>
                    {bookmarks.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-slate-400">No bookmarks yet. Bookmark a repo to see it here.</p>
                    ) : (
                      <div className="max-h-60 overflow-y-auto">
                        {bookmarks.map((b) => (
                          <div key={`${b.owner}/${b.repo}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                            <button
                              type="button"
                              className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300"
                              onClick={() => handleSelectBookmark(b)}
                            >
                              {b.owner}/{b.repo}
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-slate-400 hover:text-rose-500"
                              title="Remove bookmark"
                              onClick={() => setBookmarks(removeBookmark(b.owner, b.repo))}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
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
            className="rounded-md border border-amber-600 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
            disabled={!canLoad || !data?.pulls.length || reviewLoadingFor !== null || !aiMode}
            onClick={() => void reviewAllOnPage()}
            title="Runs reviews sequentially; the panel will show only the last PR in the batch (v1 limitation)."
          >
            Review all on page
          </button>
          <span className="text-xs text-slate-500">{paginationLabel}</span>
        </div>

        {aiMode ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Review rules</span>
                <span className="text-[10px] text-slate-400">(applied alongside built-in rules)</span>
              </div>
              {savedRules.length > 0 ? (
                <div className="flex items-center gap-1">
                  <select
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                    value=""
                    onChange={(e) => {
                      const rule = savedRules.find((r) => r.name === e.target.value);
                      if (rule) setReviewPrompt(rule.prompt);
                    }}
                  >
                    <option value="" disabled>Load saved rule…</option>
                    {savedRules.map((r) => (
                      <option key={r.name} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <textarea
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600"
              rows={2}
              placeholder="e.g. Ensure all public functions have error handling. Check for proper logging. Flag any hardcoded secrets..."
              value={reviewPrompt}
              onChange={(e) => setReviewPrompt(e.target.value)}
            />
            <div className="flex items-center gap-2">
              {showSaveInput ? (
                <div className="flex items-center gap-1">
                  <input
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                    placeholder="Rule name"
                    value={saveRuleName}
                    onChange={(e) => setSaveRuleName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSaveRule(); }}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                    disabled={!saveRuleName.trim() || !reviewPrompt.trim() || savingRule}
                    onClick={() => void handleSaveRule()}
                  >
                    {savingRule ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                    onClick={() => { setShowSaveInput(false); setSaveRuleName(""); }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
                  disabled={!reviewPrompt.trim()}
                  onClick={() => setShowSaveInput(true)}
                >
                  Save rule
                </button>
              )}
              {savedRules.length > 0 ? (
                <select
                  className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-600 outline-none hover:bg-rose-50 dark:border-rose-700 dark:bg-slate-950 dark:text-rose-400"
                  value=""
                  onChange={(e) => { if (e.target.value) void handleDeleteRule(e.target.value); }}
                >
                  <option value="" disabled>Delete rule…</option>
                  {savedRules.map((r) => (
                    <option key={r.name} value={r.name}>{r.name}</option>
                  ))}
                </select>
              ) : null}
            </div>

            {/* Repo coding rules (Cursor / Claude) */}
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Repo coding rules
                  </span>
                  {repoRulesLoading ? (
                    <span className="text-[10px] text-slate-400">Loading…</span>
                  ) : allRuleFiles.length > 0 ? (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      {allRuleFiles.length} file{allRuleFiles.length > 1 ? "s" : ""} found
                    </span>
                  ) : repoRules ? (
                    <span className="text-[10px] text-slate-400">No .cursor or .claude rules found</span>
                  ) : null}
                  {selectedRulePaths.size > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      {selectedRulePaths.size} selected for review
                    </span>
                  )}
                </div>
                {allRuleFiles.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    onClick={() => setShowRepoRules((v) => !v)}
                  >
                    {showRepoRules ? "Hide" : "Show rules"}
                  </button>
                )}
              </div>

              {selectedRulePaths.size > 0 && (
                <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  Selected rules will be included in the review prompt, which may increase review time.
                </p>
              )}

              {repoRulesError && (
                <p className="mt-1.5 text-[10px] text-rose-500">{repoRulesError}</p>
              )}

              {showRepoRules && allRuleFiles.length > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  {/* Select all / none */}
                  <div className="flex items-center gap-3 border-b border-slate-200 pb-2 dark:border-slate-700">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={selectedRulePaths.size === allRuleFiles.length}
                        ref={(el) => { if (el) el.indeterminate = selectedRulePaths.size > 0 && selectedRulePaths.size < allRuleFiles.length; }}
                        onChange={(e) => toggleAllRules(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      <span className="text-[11px] font-medium text-slate-500">
                        {selectedRulePaths.size === allRuleFiles.length ? "Deselect all" : "Select all"}
                      </span>
                    </label>
                  </div>

                  {allRuleFiles.map((rf) => {
                    const isSelected = selectedRulePaths.has(rf.path);
                    const colorCls = rf.source === "cursor"
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-violet-600 dark:text-violet-400";
                    const tagLabel = rf.source === "cursor" ? "Cursor" : "Claude";
                    const tagCls = rf.source === "cursor"
                      ? "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300"
                      : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300";

                    return (
                      <div key={rf.path} className="rounded-md border border-slate-200 dark:border-slate-700">
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRulePath(rf.path)}
                            className="h-3.5 w-3.5 rounded border-slate-300"
                          />
                          <span className={`text-[11px] font-semibold ${colorCls}`}>{rf.path}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tagCls}`}>{tagLabel}</span>
                        </label>
                        {isSelected && (
                          <textarea
                            readOnly
                            className="w-full resize-y border-t border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                            rows={Math.min(10, rf.content.split("\n").length + 1)}
                            value={rf.content}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
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
                      onClick={() => setSearch("")}
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

              {availableReviewers.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500">Reviewer</span>
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                    value={reviewerFilter}
                    onChange={(e) => setReviewerFilter(e.target.value)}
                  >
                    <option value="">All reviewers</option>
                    {availableReviewers.map((login) => (
                      <option key={login} value={login}>{login}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="text-xs text-slate-500">
              Showing {pullsForTable.length} / {data.pulls.length}
            </div>
          </div>

          {metricsMode ? <MetricsPanel owner={owner.trim()} repo={repo.trim()} /> : null}

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <thead className="bg-slate-100/80 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Mergeable</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">CI &amp; Reviews</th>
                  <th className="px-3 py-2">Activity</th>
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
                              className="rounded p-1 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-900"
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
                              <a
                                href={`https://github.com/${owner}/${repo}/pull/${p.number}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-slate-900 hover:text-emerald-700 hover:underline dark:text-slate-100 dark:hover:text-emerald-400"
                              >#{p.number}</a>
                              <div className="max-w-xs text-xs text-slate-600 dark:text-slate-400">{p.title}</div>
                              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                                {p.author} · {p.head} → {p.base}
                                {p.draft ? " · draft" : ""}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-center">
                          <span className={`text-2xl font-bold ${scoreTone(p.readiness.score)}`}>
                            {p.readiness.score}
                          </span>
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1.5">
                            <div
                              title={reviewReadyReason(p)}
                              className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                                ready
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100"
                                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
                              }`}
                            >
                              {ready ? "Ready" : "Not ready"}
                            </div>
                            <div className="grid gap-0.5 text-[11px]">
                              {p.readiness.breakdown.draftPenalty > 0 && (
                                <div className="text-amber-700 dark:text-amber-300">−{p.readiness.breakdown.draftPenalty} draft</div>
                              )}
                              {p.readiness.breakdown.mergePenalty > 0 && (
                                <div className="text-rose-700 dark:text-rose-300">−{p.readiness.breakdown.mergePenalty} merge</div>
                              )}
                              {p.readiness.breakdown.reviewPenalty > 0 && (
                                <div className="text-rose-700 dark:text-rose-300">−{p.readiness.breakdown.reviewPenalty} review</div>
                              )}
                              {p.readiness.breakdown.checkPenalty > 0 && (
                                <div className="text-rose-700 dark:text-rose-300">−{p.readiness.breakdown.checkPenalty} checks</div>
                              )}
                              {p.readiness.breakdown.approvalBonus > 0 && (
                                <div className="text-emerald-700 dark:text-emerald-300">+{p.readiness.breakdown.approvalBonus} approval</div>
                              )}
                              {p.readiness.breakdown.draftPenalty === 0 &&
                                p.readiness.breakdown.mergePenalty === 0 &&
                                p.readiness.breakdown.reviewPenalty === 0 &&
                                p.readiness.breakdown.checkPenalty === 0 &&
                                p.readiness.breakdown.approvalBonus === 0 && (
                                <div className="text-slate-500">no penalties</div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-3 py-3 text-xs">
                          {(() => {
                            const conflicted = p.mergeable === false || p.mergeable_state === "dirty";
                            const clean = p.mergeable === true && !conflicted;
                            const unknown = p.mergeable === null;
                            const tags: { label: string; cls: string }[] = [];
                            if (clean) tags.push({ label: "Clean", cls: "text-emerald-700 dark:text-emerald-300" });
                            if (conflicted) tags.push({ label: "Conflict", cls: "text-rose-700 dark:text-rose-300" });
                            if (unknown) tags.push({ label: "Unknown", cls: "text-slate-500 dark:text-slate-400" });
                            if (p.draft) tags.push({ label: "Draft", cls: "text-amber-700 dark:text-amber-300" });
                            if (p.checks.failing > 0) tags.push({ label: "CI failing", cls: "text-rose-700 dark:text-rose-300" });
                            if (p.checks.pending > 0) tags.push({ label: "CI pending", cls: "text-amber-600 dark:text-amber-200" });
                            if (p.readiness.breakdown.changesRequested > 0) tags.push({ label: "Changes requested", cls: "text-rose-700 dark:text-rose-300" });
                            if (p.readiness.breakdown.approvals > 0) tags.push({ label: `${p.readiness.breakdown.approvals} approved`, cls: "text-emerald-700 dark:text-emerald-300" });
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
                          {(() => {
                            const sz = prSize(p.additions, p.deletions);
                            return (
                              <div className="flex flex-col items-start gap-1">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${sz.color}`}>
                                  {sz.label}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  <span className="text-emerald-700 dark:text-emerald-400">+{p.additions}</span>{" "}
                                  <span className="text-rose-700 dark:text-rose-400">−{p.deletions}</span>
                                </span>
                              </div>
                            );
                          })()}
                        </td>

                        <td className="px-3 py-3 text-xs">
                          <div className="flex flex-col gap-1.5">
                            <div className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700/50 dark:bg-slate-900/40">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Checks</div>
                              <div className="mt-0.5 text-slate-600 dark:text-slate-300">total {p.checks.total}</div>
                              <div className="text-rose-600 dark:text-rose-300">fail {p.checks.failing}</div>
                              <div className="text-amber-600 dark:text-amber-200">pending {p.checks.pending}</div>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700/50 dark:bg-slate-900/40">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Reviews</div>
                              <div className="mt-0.5 text-emerald-700 dark:text-emerald-300">approve {ack.approved}</div>
                              <div className="text-rose-600 dark:text-rose-300">changes {ack.changes}</div>
                              <div className="text-slate-500 dark:text-slate-400">comment {ack.commented}</div>
                              <div className="text-slate-400 dark:text-slate-500">people {ack.participants}</div>
                            </div>
                          </div>
                        </td>

                        {(() => {
                          const age = timeAgo(p.created_at);
                          const activity = timeAgo(p.last_activity_at);
                          return (
                            <td className="px-3 py-3 text-xs">
                              <div className="flex flex-col gap-1.5">
                                <div className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700/50 dark:bg-slate-900/40">
                                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Timeline</div>
                                  <div className="mt-0.5 text-slate-600 dark:text-slate-300" title={age.title}>
                                    <span className="text-slate-400 dark:text-slate-500">opened </span>
                                    <span className={ageBadgeColor(p.created_at)}>{age.text}</span>
                                  </div>
                                  <div className="text-slate-600 dark:text-slate-300" title={activity.title}>
                                    <span className="text-slate-400 dark:text-slate-500">active </span>
                                    <span className={p.last_activity_at ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500"}>
                                      {activity.text}
                                    </span>
                                  </div>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700/50 dark:bg-slate-900/40">
                                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Comments</div>
                                  <div className="mt-0.5 text-slate-600 dark:text-slate-300">issue {p.comments} · review {p.review_comments}</div>
                                  <div className="text-slate-400 dark:text-slate-500">commits {p.commits}</div>
                                </div>
                              </div>
                            </td>
                          );
                        })()}

                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900"
                              disabled={!aiMode || reviewLoadingFor === p.number}
                              title={!aiMode ? "Enable AI mode to run AI review" : undefined}
                              onClick={() => void runReview(p.number)}
                            >
                              {reviewLoadingFor === p.number ? "Reviewing…" : "AI Review"}
                            </button>
                            {assignedReviewers[p.number]?.length > 0 && (
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Reviewers</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {assignedReviewers[p.number].map((login) => {
                                    const member = teamMembers[login];
                                    return (
                                      <span key={login} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" title={login}>
                                        {member?.avatar_url ? (
                                          <img src={member.avatar_url} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />
                                        ) : (
                                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-200 text-[9px] font-bold text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200">
                                            {login[0].toUpperCase()}
                                          </span>
                                        )}
                                        {login}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-3">
                            <div className="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                              {/* Compact status bar */}
                              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-medium text-slate-900 dark:text-slate-100">#{p.number}</span>
                                <span>
                                  Readiness{" "}
                                  <span className={ready ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-200"}>{p.readiness.score}</span>
                                </span>
                                <span>
                                  Checks{" "}
                                  <span className="text-rose-700 dark:text-rose-300">{p.checks.failing}F</span>{" "}
                                  <span className="text-amber-700 dark:text-amber-200">{p.checks.pending}P</span>
                                </span>
                                <span>
                                  Approvals <span className="text-emerald-700 dark:text-emerald-300">{p.readiness.breakdown.approvals}</span>
                                  {" · "}
                                  Changes requested <span className="text-rose-700 dark:text-rose-300">{p.readiness.breakdown.changesRequested}</span>
                                </span>
                                <span>
                                  Merge{" "}
                                  {p.mergeable === null ? "unknown" : p.mergeable ? (
                                    <span className="text-emerald-700 dark:text-emerald-300">clean</span>
                                  ) : (
                                    <span className="text-rose-700 dark:text-rose-300">conflict</span>
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
                                      <p className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
                                        {gl.error}
                                      </p>
                                    ) : null}

                                    {gl?.summary || gl?.walkthrough?.length ? (
                                      <GlanceView summary={gl.summary ?? ""} walkthrough={gl.walkthrough ?? []} />
                                    ) : gl?.markdown ? (
                                      <GlanceFallback markdown={gl.markdown} />
                                    ) : null}

                                    {!gl?.loading && !gl?.summary && !gl?.walkthrough?.length && !gl?.markdown && !gl?.error ? (
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
                                      <p className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
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
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-400">
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
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>Review for #{reviewOpenFor}</span>
                {reviewData?.model ? <span className="text-slate-500"> · {reviewData.model}</span> : null}
                {reviewData?.verdict ? (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${(VERDICT_CONFIG[reviewData.verdict] ?? VERDICT_CONFIG.comment).cls}`}>
                    {(VERDICT_CONFIG[reviewData.verdict] ?? VERDICT_CONFIG.comment).label}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {reviewData?.comments?.length ? (
                  <button
                    type="button"
                    className="rounded-md border border-emerald-500 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
                    disabled={submitLoading || submitResult?.success === true}
                    onClick={() => void submitReviewToPr()}
                  >
                    {submitLoading ? "Submitting…" : submitResult?.success ? "Submitted" : "Submit to PR"}
                  </button>
                ) : null}
                {reviewData ? (
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                    onClick={() => {
                      const text = reviewData.markdown ?? JSON.stringify(reviewData, null, 2);
                      void navigator.clipboard.writeText(text);
                    }}
                  >
                    Copy
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                  onClick={() => {
                    setReviewOpenFor(null);
                    setReviewData(null);
                    setReviewError(null);
                    setSubmitResult(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
              {reviewLoadingFor !== null ? <p className="text-slate-400">Generating review…</p> : null}
              {reviewError ? (
                <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
                  {reviewError}
                </p>
              ) : null}
              {submitResult?.success ? (
                <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                  Review submitted to PR.{" "}
                  {submitResult.url ? (
                    <a href={submitResult.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      View on GitHub
                    </a>
                  ) : null}
                </div>
              ) : submitResult?.error ? (
                <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
                  {submitResult.error}
                </div>
              ) : null}

              {/* Main review comment (posted as the top-level body on GitHub) */}
              {reviewData && reviewLoadingFor === null ? (
                <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                    Main review comment (posted to PR, optional)
                  </label>
                  <textarea
                    className="w-full resize-y rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none ring-indigo-500/40 focus:border-indigo-400 focus:ring-2 dark:border-indigo-700 dark:bg-slate-950 dark:text-slate-300"
                    rows={3}
                    placeholder="Leave empty to post only the inline comments."
                    value={reviewData.summary}
                    onChange={(e) => {
                      setSubmitResult(null);
                      setReviewData((prev) => prev ? { ...prev, summary: e.target.value } : prev);
                    }}
                  />
                </div>
              ) : null}

              {reviewData?.comments?.length ? (
                <ReviewCommentsView
                  summary={reviewData.summary}
                  verdict={reviewData.verdict ?? "comment"}
                  comments={reviewData.comments}
                  includeCommentHeading={includeCommentHeading}
                  onUpdateSummary={(s) => { setSubmitResult(null); setReviewData((prev) => prev ? { ...prev, summary: s } : prev); }}
                  onUpdateVerdict={(v) => { setSubmitResult(null); setReviewData((prev) => prev ? { ...prev, verdict: v } : prev); }}
                  onUpdateComment={(idx, c) => {
                    setSubmitResult(null);
                    setReviewData((prev) => {
                      if (!prev?.comments) return prev;
                      const next = [...prev.comments];
                      next[idx] = c;
                      return { ...prev, comments: next };
                    });
                  }}
                  onDeleteComment={(idx) => {
                    setSubmitResult(null);
                    setReviewData((prev) => {
                      if (!prev?.comments) return prev;
                      return { ...prev, comments: prev.comments.filter((_, i) => i !== idx) };
                    });
                  }}
                  onAddComment={(c) => {
                    setSubmitResult(null);
                    setReviewData((prev) => {
                      if (!prev) return prev;
                      return { ...prev, comments: [...(prev.comments ?? []), c] };
                    });
                  }}
                />
              ) : reviewData?.markdown ? (
                <ReviewFallback markdown={reviewData.markdown} />
              ) : null}

              {/* Re-review */}
              {reviewData && reviewLoadingFor === null ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="flex items-center gap-2">
                    <textarea
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none ring-violet-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600"
                      rows={1}
                      placeholder="Ask for re-review with specific focus, e.g. 'Focus on error handling' or 'Check security implications'..."
                      value={reviewPrompt}
                      onChange={(e) => setReviewPrompt(e.target.value)}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
                      disabled={reviewLoadingFor !== null}
                      onClick={() => {
                        if (reviewOpenFor !== null) void runReview(reviewOpenFor);
                      }}
                    >
                      Re-review
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
