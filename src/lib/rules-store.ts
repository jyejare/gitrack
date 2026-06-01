import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type SavedRule = {
    name: string;
    prompt: string;
    createdAt: string;
    updatedAt: string;
};

type RulesData = Record<string, SavedRule[]>;

const DATA_DIR = join(process.cwd(), ".data");
const RULES_FILE = join(DATA_DIR, "review-rules.json");

async function readStore(): Promise<RulesData> {
    try {
        const raw = await readFile(RULES_FILE, "utf-8");
        return JSON.parse(raw) as RulesData;
    } catch {
        return {};
    }
}

async function writeStore(data: RulesData): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(RULES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function repoKey(owner: string, repo: string): string {
    return `${owner}/${repo}`;
}

export async function listRules(owner: string, repo: string): Promise<SavedRule[]> {
    const store = await readStore();
    return store[repoKey(owner, repo)] ?? [];
}

export async function saveRule(
    owner: string,
    repo: string,
    name: string,
    prompt: string,
): Promise<SavedRule> {
    const store = await readStore();
    const key = repoKey(owner, repo);
    const existing = store[key] ?? [];

    const now = new Date().toISOString();
    const idx = existing.findIndex((r) => r.name === name);
    const rule: SavedRule = { name, prompt, createdAt: idx >= 0 ? existing[idx].createdAt : now, updatedAt: now };

    if (idx >= 0) {
        existing[idx] = rule;
    } else {
        existing.push(rule);
    }

    store[key] = existing;
    await writeStore(store);
    return rule;
}

export async function deleteRule(owner: string, repo: string, name: string): Promise<boolean> {
    const store = await readStore();
    const key = repoKey(owner, repo);
    const existing = store[key];
    if (!existing) return false;

    const filtered = existing.filter((r) => r.name !== name);
    if (filtered.length === existing.length) return false;

    store[key] = filtered;
    await writeStore(store);
    return true;
}
