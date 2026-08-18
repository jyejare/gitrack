import type { UserSettings } from "@/lib/settings-store";

const STORAGE_KEY = "gitrack:llm-settings";
const BOOKMARKS_KEY = "gitrack:repo-bookmarks";

export type LlmSettings = Omit<UserSettings, "github_token">;

export type RepoBookmark = {
    owner: string;
    repo: string;
};

// ---- LLM Settings (localStorage) ----

export function loadLlmSettings(): LlmSettings {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as LlmSettings) : {};
    } catch {
        return {};
    }
}

export function saveLlmSettings(settings: LlmSettings): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearLlmSettings(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
}

export function buildLlmHeaders(): Record<string, string> {
    const settings = loadLlmSettings();
    const filled = Object.fromEntries(
        Object.entries(settings).filter(([, v]) => typeof v === "string" && v.trim()),
    );
    if (Object.keys(filled).length === 0) return {};
    return { "X-LLM-Settings": btoa(unescape(encodeURIComponent(JSON.stringify(filled)))) };
}

// ---- Repo Bookmarks (localStorage) ----

export function loadBookmarks(): RepoBookmark[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        return raw ? (JSON.parse(raw) as RepoBookmark[]) : [];
    } catch {
        return [];
    }
}

export function saveBookmark(owner: string, repo: string): RepoBookmark[] {
    const bookmarks = loadBookmarks();
    const exists = bookmarks.some(
        (b) => b.owner.toLowerCase() === owner.toLowerCase() && b.repo.toLowerCase() === repo.toLowerCase(),
    );
    if (!exists) {
        bookmarks.push({ owner, repo });
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    }
    return bookmarks;
}

export function removeBookmark(owner: string, repo: string): RepoBookmark[] {
    const bookmarks = loadBookmarks().filter(
        (b) => !(b.owner.toLowerCase() === owner.toLowerCase() && b.repo.toLowerCase() === repo.toLowerCase()),
    );
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    return bookmarks;
}

// ---- Review Rules (localStorage, per-repo) ----

const RULES_KEY = "gitrack:review-rules";

export type SavedRule = {
    name: string;
    prompt: string;
};

type RulesStore = Record<string, SavedRule[]>;

function repoKey(owner: string, repo: string): string {
    return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function loadRulesStore(): RulesStore {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(RULES_KEY);
        return raw ? (JSON.parse(raw) as RulesStore) : {};
    } catch {
        return {};
    }
}

function saveRulesStore(store: RulesStore): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(RULES_KEY, JSON.stringify(store));
}

export function loadReviewRules(owner: string, repo: string): SavedRule[] {
    return loadRulesStore()[repoKey(owner, repo)] ?? [];
}

export function saveReviewRule(owner: string, repo: string, name: string, prompt: string): SavedRule[] {
    const store = loadRulesStore();
    const key = repoKey(owner, repo);
    const existing = store[key] ?? [];
    const idx = existing.findIndex((r) => r.name === name);
    const rule: SavedRule = { name, prompt };
    if (idx >= 0) existing[idx] = rule;
    else existing.push(rule);
    store[key] = existing;
    saveRulesStore(store);
    return existing;
}

export function deleteReviewRule(owner: string, repo: string, name: string): SavedRule[] {
    const store = loadRulesStore();
    const key = repoKey(owner, repo);
    const existing = store[key] ?? [];
    store[key] = existing.filter((r) => r.name !== name);
    saveRulesStore(store);
    return store[key];
}

// ---- Repo URL parsing ----

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    // https://github.com/owner/repo or github.com/owner/repo
    const urlMatch = trimmed.match(
        /^(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s#?]+)/,
    );
    if (urlMatch) {
        return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
    }

    // owner/repo
    const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (slashMatch) {
        return { owner: slashMatch[1], repo: slashMatch[2].replace(/\.git$/, "") };
    }

    return null;
}
