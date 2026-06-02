import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { encrypt, decrypt } from "@/lib/crypto";

export type UserSettings = {
    github_token?: string;
    llm_provider?: string;
    anthropic_api_key?: string;
    anthropic_model?: string;
    groq_api_key?: string;
    groq_model?: string;
    ollama_host?: string;
    ollama_model?: string;
    vertex_project_id?: string;
    vertex_region?: string;
    vertex_model?: string;
    vertex_sa_key?: string;
};

type SettingsStore = Record<string, string>;

const DATA_DIR = join(process.cwd(), ".data");
const SETTINGS_FILE = join(DATA_DIR, "user-settings.json");

function getSecret(): string {
    return process.env.SETTINGS_ENCRYPTION_KEY ?? "gitrack-default-key-change-me";
}

async function readStore(): Promise<SettingsStore> {
    try {
        const raw = await readFile(SETTINGS_FILE, "utf-8");
        return JSON.parse(raw) as SettingsStore;
    } catch {
        return {};
    }
}

async function writeStore(data: SettingsStore): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function getSettings(sessionId: string): Promise<UserSettings | null> {
    const store = await readStore();
    const encrypted = store[sessionId];
    if (!encrypted) return null;
    try {
        const json = decrypt(encrypted, getSecret());
        return JSON.parse(json) as UserSettings;
    } catch {
        return null;
    }
}

export async function saveSettings(sessionId: string, settings: UserSettings): Promise<void> {
    const store = await readStore();
    store[sessionId] = encrypt(JSON.stringify(settings), getSecret());
    await writeStore(store);
}

export async function deleteSettings(sessionId: string): Promise<boolean> {
    const store = await readStore();
    if (!(sessionId in store)) return false;
    delete store[sessionId];
    await writeStore(store);
    return true;
}

export function maskKey(key: string | undefined): string {
    if (!key) return "";
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "…" + key.slice(-4);
}
