import { getGithubToken } from "@/lib/request-context";

const GITHUB_API = "https://api.github.com";

type GithubFetchOptions = RequestInit & { next?: { revalidate?: number } };

export async function githubFetch(path: string, options: GithubFetchOptions = {}) {
  const token = getGithubToken();
  const { next, ...init } = options;
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    ...(next ? { next } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch GitHub ${path} (${res.status}): ${text.slice(0, 500)}`);
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

export async function searchPullRequests(
  owner: string,
  repo: string,
  query: string,
  state: "open" | "closed" | "all",
) {
  const parts = [`repo:${owner}/${repo}`, "is:pr"];
  if (state !== "all") parts.push(`is:${state}`);
  parts.push(`${query} in:title`);
  const q = encodeURIComponent(parts.join(" "));
  const res = await githubFetch(`/search/issues?q=${q}&per_page=20&sort=updated&order=desc`);
  const json = (await res.json()) as {
    items: Array<{ number: number; pull_request?: { url: string } }>;
  };
  return (json.items ?? [])
    .filter((i) => i.pull_request)
    .map((i) => i.number);
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
  created_at: string;
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

type CommitStatusItem = {
  state: "success" | "failure" | "pending" | "error" | string;
  context: string;
};

export async function listCommitStatuses(owner: string, repo: string, sha: string): Promise<CheckRun[]> {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/commits/${sha}/status`,
  );
  const json = (await res.json()) as { statuses: CommitStatusItem[] };

  // Dedupe by context (GitHub returns newest first, keep first per context)
  const seen = new Set<string>();
  const unique: CommitStatusItem[] = [];
  for (const s of json.statuses ?? []) {
    if (!seen.has(s.context)) {
      seen.add(s.context);
      unique.push(s);
    }
  }

  return unique.map((s) => ({
    name: s.context,
    status: s.state === "pending" ? "in_progress" as const : "completed" as const,
    conclusion:
      s.state === "success" ? "success" as const
        : s.state === "failure" || s.state === "error" ? "failure" as const
          : null,
  }));
}

export async function getLatestCommentDate(
  owner: string,
  repo: string,
  number: number,
): Promise<string | null> {
  const [issueRes, reviewRes] = await Promise.all([
    githubFetch(
      `/repos/${owner}/${repo}/issues/${number}/comments?sort=created&direction=desc&per_page=1`,
    ),
    githubFetch(
      `/repos/${owner}/${repo}/pulls/${number}/comments?sort=created&direction=desc&per_page=1`,
    ),
  ]);
  const issueComments = (await issueRes.json()) as { created_at: string }[];
  const reviewComments = (await reviewRes.json()) as { created_at: string }[];

  const dates: number[] = [];
  if (issueComments[0]?.created_at) dates.push(Date.parse(issueComments[0].created_at));
  if (reviewComments[0]?.created_at) dates.push(Date.parse(reviewComments[0].created_at));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates)).toISOString();
}

export type SubmitReviewComment = {
  path: string;
  body: string;
  line?: number;
  start_line?: number;
};

export async function submitPrReview(
  owner: string,
  repo: string,
  number: number,
  input: {
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    body: string;
    comments: SubmitReviewComment[];
  },
) {
  const inline = input.comments.filter((c) => c.line);
  const orphaned = input.comments.filter((c) => !c.line);

  let body = input.body;
  if (orphaned.length > 0) {
    body += "\n\n---\n\n" + orphaned.map((c) => c.body).join("\n\n---\n\n");
  }

  const ghComments = inline.map((c) => {
    const obj: Record<string, unknown> = {
      path: c.path,
      body: c.body,
      line: c.line,
      side: "RIGHT",
    };
    if (c.start_line && c.start_line < c.line!) {
      obj.start_line = c.start_line;
      obj.start_side = "RIGHT";
    }
    return obj;
  });

  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: input.event,
      body,
      ...(ghComments.length > 0 ? { comments: ghComments } : {}),
    }),
  });

  return (await res.json()) as { id: number; html_url?: string };
}

/**
 * Parse a unified diff and return the set of right-side (new file) line numbers
 * visible in each file's hunks. GitHub only accepts inline review comments on
 * lines that appear in the diff.
 */
export function parseDiffValidLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const lines = diff.split("\n");
  let currentFile: string | null = null;
  let rightLine = 0;

  for (const raw of lines) {
    const fileMatch = raw.match(/^diff --git a\/.+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!result.has(currentFile)) result.set(currentFile, new Set());
      continue;
    }

    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      rightLine = Number(hunkMatch[1]);
      continue;
    }

    if (!currentFile || rightLine === 0) continue;

    if (raw.startsWith("-")) {
      // deleted line — only on left side, don't advance right counter
      continue;
    }
    if (raw.startsWith("+") || raw.startsWith(" ")) {
      result.get(currentFile)!.add(rightLine);
      rightLine++;
    }
  }

  return result;
}

/**
 * Given a target line and the set of valid lines for a file, return the
 * closest valid line, or undefined if none exist.
 */
export function snapToValidLine(target: number, validLines: Set<number>): number | undefined {
  if (validLines.has(target)) return target;
  let best: number | undefined;
  let bestDist = Infinity;
  for (const v of validLines) {
    const d = Math.abs(v - target);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  return best;
}

export type Collaborator = {
  login: string;
  avatar_url: string;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
};

export async function listCollaborators(owner: string, repo: string): Promise<Collaborator[]> {
  const all: Collaborator[] = [];
  let page = 1;
  while (true) {
    const res = await githubFetch(
      `/repos/${owner}/${repo}/collaborators?per_page=100&page=${page}`,
    );
    const batch = (await res.json()) as Collaborator[];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

export async function requestReviewers(
  owner: string,
  repo: string,
  number: number,
  reviewers: string[],
): Promise<{ requested_reviewers: { login: string }[] }> {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewers }),
    },
  );
  return (await res.json()) as { requested_reviewers: { login: string }[] };
}

// ---- Repo file content (Contents API) ----

type ContentsEntry = { name: string; path: string; type: "file" | "dir" };
type ContentsFile = { encoding?: string; content?: string };

async function fetchFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string | null> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const token = getGithubToken();
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${q}`, {
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ContentsFile;
    if (data.encoding === "base64" && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
}

async function listDirEntries(owner: string, repo: string, path: string, ref?: string): Promise<ContentsEntry[]> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const token = getGithubToken();
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${q}`, {
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as ContentsEntry[]) : [];
}

export type RepoRules = {
    cursor: { path: string; content: string }[];
    claude: { path: string; content: string }[];
};

async function collectFiles(
    owner: string, repo: string, ref: string | undefined,
    entries: ContentsEntry[],
    pattern: RegExp,
): Promise<{ path: string; content: string }[]> {
    const matched = entries.filter((e) => e.type === "file" && pattern.test(e.name));
    const results = await Promise.allSettled(
        matched.map((f) => fetchFileContent(owner, repo, f.path, ref)),
    );
    const out: { path: string; content: string }[] = [];
    for (let i = 0; i < matched.length; i++) {
        const r = results[i];
        const content = r.status === "fulfilled" ? r.value : null;
        if (content) out.push({ path: matched[i].path, content });
    }
    return out;
}

/**
 * Resolve a relative path reference against the file that contains it.
 * e.g. filePath=".claude/skills/foo/SKILL.md", ref="../../../skills/foo/SKILL.md"
 *   => "skills/foo/SKILL.md"
 */
function resolveRelativePath(filePath: string, relativeTo: string): string {
    const parts = filePath.split("/").slice(0, -1); // directory of the referencing file
    for (const seg of relativeTo.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
}

/**
 * Skills live in subdirectories (e.g. .claude/skills/foo/SKILL.md).
 * The SKILL.md may contain actual content OR a relative path reference
 * (e.g. "../../../skills/foo/SKILL.md") pointing to the real file.
 */
async function collectSkillFiles(
    owner: string, repo: string, ref: string | undefined,
    parentEntries: ContentsEntry[],
): Promise<{ path: string; content: string }[]> {
    const dirs = parentEntries.filter((e) => e.type === "dir");
    if (dirs.length === 0) return [];

    const skillPaths = dirs.map((d) => `${d.path}/SKILL.md`);
    const results = await Promise.allSettled(
        skillPaths.map((p) => fetchFileContent(owner, repo, p, ref)),
    );

    const out: { path: string; content: string }[] = [];
    const redirects: { displayPath: string; targetPath: string }[] = [];

    for (let i = 0; i < dirs.length; i++) {
        const r = results[i];
        const content = r.status === "fulfilled" ? r.value : null;
        if (!content) continue;

        const trimmed = content.trim();
        // Detect if the content is just a relative path reference (short, single line, looks like a path)
        if (trimmed.length < 200 && !trimmed.includes("\n") && /^\.{1,3}\//.test(trimmed)) {
            const resolved = resolveRelativePath(skillPaths[i], trimmed);
            redirects.push({ displayPath: skillPaths[i], targetPath: resolved });
        } else {
            out.push({ path: skillPaths[i], content });
        }
    }

    // Fetch the real files that were referenced by path
    if (redirects.length > 0) {
        const realResults = await Promise.allSettled(
            redirects.map((rd) => fetchFileContent(owner, repo, rd.targetPath, ref)),
        );
        for (let i = 0; i < redirects.length; i++) {
            const r = realResults[i];
            const content = r.status === "fulfilled" ? r.value : null;
            if (content) out.push({ path: redirects[i].targetPath, content });
        }
    }

    return out;
}

export async function fetchRepoRules(owner: string, repo: string, ref?: string): Promise<RepoRules> {
    const rules: RepoRules = { cursor: [], claude: [] };

    const [
        cursorrules,
        cursorRulesDir, cursorSkillsDir,
        rootClaude, rootAgents,
        claudeDir, claudeRulesDir, claudeSkillsDir,
    ] = await Promise.all([
        fetchFileContent(owner, repo, ".cursorrules", ref),
        listDirEntries(owner, repo, ".cursor/rules", ref),
        listDirEntries(owner, repo, ".cursor/skills", ref),
        fetchFileContent(owner, repo, "CLAUDE.md", ref),
        fetchFileContent(owner, repo, "AGENTS.md", ref),
        listDirEntries(owner, repo, ".claude", ref),
        listDirEntries(owner, repo, ".claude/rules", ref),
        listDirEntries(owner, repo, ".claude/skills", ref),
    ]);

    const mdPattern = /\.(md|mdc)$/i;

    // Cursor: .cursorrules (legacy)
    if (cursorrules) {
        rules.cursor.push({ path: ".cursorrules", content: cursorrules });
    }

    // Cursor: .cursor/rules/*.md, *.mdc
    rules.cursor.push(...await collectFiles(owner, repo, ref, cursorRulesDir, mdPattern));

    // Cursor: .cursor/skills/*/SKILL.md (nested) + any loose .md/.mdc files
    rules.cursor.push(...await collectFiles(owner, repo, ref, cursorSkillsDir, mdPattern));
    rules.cursor.push(...await collectSkillFiles(owner, repo, ref, cursorSkillsDir));

    // Claude: root CLAUDE.md
    if (rootClaude) {
        rules.claude.push({ path: "CLAUDE.md", content: rootClaude });
    }

    // Claude: root AGENTS.md
    if (rootAgents) {
        rules.claude.push({ path: "AGENTS.md", content: rootAgents });
    }

    // Claude: .claude/*.md
    rules.claude.push(...await collectFiles(owner, repo, ref, claudeDir, mdPattern));

    // Claude: .claude/rules/*.md
    rules.claude.push(...await collectFiles(owner, repo, ref, claudeRulesDir, mdPattern));

    // Claude: .claude/skills/*/SKILL.md (nested) + any loose .md files
    rules.claude.push(...await collectFiles(owner, repo, ref, claudeSkillsDir, mdPattern));
    rules.claude.push(...await collectSkillFiles(owner, repo, ref, claudeSkillsDir));

    return rules;
}

export async function getPullDiff(owner: string, repo: string, number: number) {
  const token = getGithubToken();
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
    throw new Error(`Failed to fetch GitHub diff (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.text();
}
