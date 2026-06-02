import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { encrypt, decrypt } from "@/lib/crypto";

export const PR_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type PrSizeLabel = (typeof PR_SIZES)[number];

export type AssignmentRule = {
    id: string;
    name: string;
    enabled: boolean;
    sizes: PrSizeLabel[];
    keywords: string[];
    reviewers: string[];
};

export type RepoAssignmentConfig = {
    owner: string;
    repo: string;
    rules: AssignmentRule[];
};

type AssignmentStore = Record<string, string>;

const DATA_DIR = join(process.cwd(), ".data");
const STORE_FILE = join(DATA_DIR, "assignment-rules.json");

function getSecret(): string {
    return process.env.SETTINGS_ENCRYPTION_KEY ?? "gitrack-default-key-change-me";
}

function storeKey(userId: string, owner: string, repo: string): string {
    return `${userId}:${owner}/${repo}`;
}

async function readStore(): Promise<AssignmentStore> {
    try {
        const raw = await readFile(STORE_FILE, "utf-8");
        return JSON.parse(raw) as AssignmentStore;
    } catch {
        return {};
    }
}

async function writeStore(data: AssignmentStore): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function getRules(userId: string, owner: string, repo: string): Promise<AssignmentRule[]> {
    const store = await readStore();
    const encrypted = store[storeKey(userId, owner, repo)];
    if (!encrypted) return [];
    try {
        const json = decrypt(encrypted, getSecret());
        return JSON.parse(json) as AssignmentRule[];
    } catch {
        return [];
    }
}

export async function saveRules(userId: string, owner: string, repo: string, rules: AssignmentRule[]): Promise<void> {
    const store = await readStore();
    store[storeKey(userId, owner, repo)] = encrypt(JSON.stringify(rules), getSecret());
    await writeStore(store);
}

export async function deleteRules(userId: string, owner: string, repo: string): Promise<boolean> {
    const store = await readStore();
    const key = storeKey(userId, owner, repo);
    if (!(key in store)) return false;
    delete store[key];
    await writeStore(store);
    return true;
}
