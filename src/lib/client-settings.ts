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
