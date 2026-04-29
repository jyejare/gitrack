import type { CheckRun, ReviewItem } from "@/lib/github";

export type ReadinessBreakdown = {
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

export type ReadinessResult = {
  score: number;
  breakdown: ReadinessBreakdown;
};

/**
 * Deduplicate check runs by name (re-runs produce multiple entries)
 * and count only meaningful statuses (skip neutral/skipped/cancelled).
 */
export function summarizeChecks(checkRuns: CheckRun[]) {
  // GitHub returns check runs newest-first; keep first occurrence per name
  const latest = new Map<string, CheckRun>();
  for (const r of checkRuns) {
    if (!latest.has(r.name)) {
      latest.set(r.name, r);
    }
  }

  let total = 0;
  let failing = 0;
  let pending = 0;
  let passing = 0;
  for (const r of latest.values()) {
    if (r.status !== "completed") {
      total += 1;
      pending += 1;
      continue;
    }
    if (r.conclusion === "skipped" || r.conclusion === "neutral" || r.conclusion === "cancelled") {
      continue;
    }
    total += 1;
    if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "action_required") {
      failing += 1;
    } else {
      passing += 1;
    }
  }
  return { total, failing, pending, passing };
}

function latestReviewStates(reviews: ReviewItem[]) {
  const byUser = new Map<string, ReviewItem>();
  const sorted = [...reviews].sort((a, b) => {
    const ta = a.submitted_at ? Date.parse(a.submitted_at) : 0;
    const tb = b.submitted_at ? Date.parse(b.submitted_at) : 0;
    return ta - tb;
  });
  for (const r of sorted) {
    const login = r.user?.login;
    if (!login) continue;
    byUser.set(login, r);
  }
  let approvals = 0;
  let changesRequested = 0;
  for (const r of byUser.values()) {
    if (r.state === "APPROVED") approvals += 1;
    if (r.state === "CHANGES_REQUESTED") changesRequested += 1;
  }
  return { approvals, changesRequested };
}

export function computeReadiness(input: {
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  reviews: ReviewItem[];
  checkRuns: CheckRun[];
}): ReadinessResult {
  const { failing, pending } = summarizeChecks(input.checkRuns);
  const { approvals, changesRequested } = latestReviewStates(input.reviews);

  let score = 100;
  const breakdown: ReadinessBreakdown = {
    draftPenalty: 0,
    mergePenalty: 0,
    reviewPenalty: 0,
    checkPenalty: 0,
    approvalBonus: 0,
    pendingChecks: pending,
    failingChecks: failing,
    approvals,
    changesRequested,
  };

  if (input.draft) {
    breakdown.draftPenalty = 35;
    score -= 35;
  }

  const conflicted =
    input.mergeable === false || (input.mergeable_state && input.mergeable_state === "dirty");
  if (conflicted) {
    breakdown.mergePenalty = 45;
    score -= 45;
  } else if (input.mergeable === null) {
    breakdown.mergePenalty = 5;
    score -= 5;
  }

  if (changesRequested > 0) {
    breakdown.reviewPenalty = 30;
    score -= 30;
  }

  if (failing > 0) {
    breakdown.checkPenalty = Math.min(40, 12 + failing * 8);
    score -= breakdown.checkPenalty;
  } else if (pending > 0) {
    breakdown.checkPenalty = Math.min(15, 5 + pending * 2);
    score -= breakdown.checkPenalty;
  }

  if (approvals > 0 && changesRequested === 0 && failing === 0 && pending === 0) {
    breakdown.approvalBonus = Math.min(5, approvals * 2);
    score += breakdown.approvalBonus;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, breakdown };
}
