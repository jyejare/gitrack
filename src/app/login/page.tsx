"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const { user, login } = useAuth();
    const router = useRouter();
    const [token, setToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (user) {
        router.replace("/");
        return null;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token.trim()) return;
        setLoading(true);
        setError(null);
        const result = await login(token.trim());
        if (result.error) {
            setError(result.error);
            setLoading(false);
        } else {
            router.replace("/");
        }
    };

    return (
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-8">
            <div className="flex flex-col items-center gap-3">
                <svg
                    width="48"
                    height="48"
                    viewBox="0 0 36 36"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                >
                    <rect width="36" height="36" rx="10" fill="url(#gt-bg-login)" />
                    <path
                        d="M12 8v10c0 2.2 1.8 4 4 4h4c2.2 0 4 1.8 4 4v2"
                        stroke="url(#gt-branch-login)"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                    />
                    <path d="M12 18v10" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
                    <circle cx="12" cy="8" r="2.5" fill="#34d399" />
                    <circle cx="24" cy="28" r="2.5" fill="#22d3ee" />
                    <circle cx="12" cy="28" r="2.5" fill="#94a3b8" opacity="0.6" />
                    <defs>
                        <linearGradient id="gt-bg-login" x1="0" y1="0" x2="36" y2="36">
                            <stop stopColor="#0f172a" />
                            <stop offset="1" stopColor="#1e293b" />
                        </linearGradient>
                        <linearGradient id="gt-branch-login" x1="12" y1="8" x2="24" y2="28">
                            <stop stopColor="#34d399" />
                            <stop offset="1" stopColor="#22d3ee" />
                        </linearGradient>
                    </defs>
                </svg>
                <h1 className="text-2xl font-bold tracking-tight">
                    <span className="text-slate-900 dark:text-slate-100">gi</span>
                    <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                        Track
                    </span>
                </h1>
                <p className="text-sm text-slate-500">
                    Sign in with your GitHub Personal Access Token
                </p>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="flex w-full max-w-sm flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">GitHub Token</span>
                    <input
                        type="password"
                        className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600"
                        placeholder="ghp_... or github_pat_..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoFocus
                    />
                </label>

                {error ? (
                    <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
                        {error}
                    </p>
                ) : null}

                <button
                    type="submit"
                    disabled={!token.trim() || loading}
                    className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 text-sm font-medium text-white shadow-md transition-all hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40"
                >
                    {loading ? (
                        "Verifying..."
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                            </svg>
                            Sign in
                        </>
                    )}
                </button>

                <p className="text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                    Create a token at{" "}
                    <a
                        href="https://github.com/settings/tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 underline hover:text-emerald-500 dark:text-emerald-400"
                    >
                        github.com/settings/tokens
                    </a>{" "}
                    with <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">repo</code> scope.
                    Your token is stored encrypted and used for API calls.
                </p>
            </form>
        </main>
    );
}
