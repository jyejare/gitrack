import { cookies } from "next/headers";
import { encrypt, decrypt } from "@/lib/crypto";

const COOKIE_NAME = "gitrack.session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export type GitHubUser = {
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
};

export type SessionData = {
    user: GitHubUser;
    token: string;
};

function getSecret(): string {
    return process.env.SETTINGS_ENCRYPTION_KEY ?? "gitrack-default-key-change-me";
}

export async function verifyGitHubToken(token: string): Promise<GitHubUser> {
    const res = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `GitHub returned ${res.status}`);
    }
    const data = (await res.json()) as GitHubUser;
    return {
        login: data.login,
        name: data.name,
        email: data.email,
        avatar_url: data.avatar_url,
    };
}

export async function createSession(user: GitHubUser, token: string): Promise<void> {
    const payload: SessionData = { user, token };
    const encrypted = encrypt(JSON.stringify(payload), getSecret());
    const jar = await cookies();
    jar.set(COOKIE_NAME, encrypted, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE,
        path: "/",
    });
}

export async function getSession(): Promise<SessionData | null> {
    const jar = await cookies();
    const cookie = jar.get(COOKIE_NAME);
    if (!cookie?.value) return null;
    try {
        const json = decrypt(cookie.value, getSecret());
        return JSON.parse(json) as SessionData;
    } catch {
        return null;
    }
}

export async function clearSession(): Promise<void> {
    const jar = await cookies();
    jar.delete(COOKIE_NAME);
}
