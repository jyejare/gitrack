"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearLlmSettings } from "@/lib/client-settings";

type User = {
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
};

type AuthContextValue = {
    user: User | null;
    loading: boolean;
    login: (token: string) => Promise<{ error?: string }>;
    logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/auth/me")
            .then((r) => r.json())
            .then((data: { user: User | null }) => setUser(data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const login = useCallback(async (token: string): Promise<{ error?: string }> => {
        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token }),
            });
            const json = (await res.json()) as { user?: User; error?: string };
            if (!res.ok) return { error: json.error ?? "Failed to sign in" };
            setUser(json.user ?? null);
            return {};
        } catch {
            return { error: "Failed to sign in" };
        }
    }, []);

    const logout = useCallback(async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        clearLlmSettings();
        setUser(null);
    }, []);

    const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

    return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthCtx);
    if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
    return ctx;
}
