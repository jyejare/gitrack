import { requireEnv } from "@/lib/env";

const GITHUB_API = "https://api.github.com";

type GithubFetchOptions = RequestInit & { next?: { revalidate?: number } };

export async function githubFetch(path: string, options: GithubFetchOptions = {}) {
  const token = requireEnv("GITHUB_TOKEN");
  const { next, ...init } = options;
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    next: next ?? { revalidate: 45 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text.slice(0, 500)}`);
  }

  return res;
}

export type PullListItem = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  user: { login: string } | null;
  /** `head.repo` is the fork (or same repo) that contains `head.sha`; needed for Checks API on fork PRs. */
  head: {
    sha: string;
    ref: string;
    repo: { name: string; owner: { login: string } } | null;
  };
  base: { ref: string };
  updated_at: string;
};

export async function listPullRequests(
  owner: string,
  repo: string,
  params: { state: "open" | "closed" | "all"; page: number; perPage: number },
) {
  const q = new URLSearchParams({
    state: params.state,
    page: String(params.page),
    per_page: String(params.perPage),
    sort: "updated",
    direction: "desc",
  });
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls?${q}`);
  const data = (await res.json()) as PullListItem[];
  const link = res.headers.get("link") ?? "";
  return { pulls: data, link };
}

export function parseLinkHeader(link: string): { next?: number; last?: number } {
  const out: { next?: number; last?: number } = {};
  if (!link) return out;
  for (const part of link.split(",")) {
    const m = part.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="(\w+)"/);
    if (!m) continue;
    const page = Number(m[1]);
    const rel = m[2];
    if (rel === "next") out.next = page;
    if (rel === "last") out.last = page;
  }
  return out;
}

export type PullDetail = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  base: { ref: string };
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  updated_at: string;
};

export async function getPullDetail(owner: string, repo: string, number: number) {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}`);
  return (await res.json()) as PullDetail;
}

export type ReviewItem = {
  id: number;
  user: { login: string } | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | string;
  submitted_at: string | null;
};

export async function listPullReviews(owner: string, repo: string, number: number) {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
  return (await res.json()) as ReviewItem[];
}

export type CheckRun = {
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
};

export async function listCheckRunsForRef(owner: string, repo: string, sha: string) {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
  );
  const json = (await res.json()) as { check_runs: CheckRun[] };
  return json.check_runs ?? [];
}

export async function getPullDiff(owner: string, repo: string, number: number) {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, {
    headers: {
      Accept: "application/vnd.github.diff",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub diff ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.text();
}
