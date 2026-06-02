"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthContext";
import Link from "next/link";

type FieldConfig = {
    key: string;
    label: string;
    placeholder: string;
    sensitive: boolean;
    multiline?: boolean;
    provider?: string;
};

const FIELDS: FieldConfig[] = [
    { key: "llm_provider", label: "LLM Provider", placeholder: "anthropic | groq | ollama | vertex", sensitive: false },
    { key: "anthropic_api_key", label: "Anthropic API Key", placeholder: "sk-ant-...", sensitive: true, provider: "anthropic" },
    { key: "anthropic_model", label: "Anthropic Model", placeholder: "claude-3-5-sonnet-20241022", sensitive: false, provider: "anthropic" },
    { key: "groq_api_key", label: "Groq API Key", placeholder: "gsk_...", sensitive: true, provider: "groq" },
    { key: "groq_model", label: "Groq Model", placeholder: "llama3-70b-8192", sensitive: false, provider: "groq" },
    { key: "ollama_host", label: "Ollama Host", placeholder: "http://localhost:11434", sensitive: false, provider: "ollama" },
    { key: "ollama_model", label: "Ollama Model", placeholder: "llama3", sensitive: false, provider: "ollama" },
    { key: "vertex_project_id", label: "Vertex Project ID", placeholder: "my-gcp-project", sensitive: false, provider: "vertex" },
    { key: "vertex_region", label: "Vertex Region", placeholder: "us-east5", sensitive: false, provider: "vertex" },
    { key: "vertex_model", label: "Vertex Model", placeholder: "claude-sonnet-4@20250514", sensitive: false, provider: "vertex" },
    { key: "vertex_sa_key", label: "Vertex SA Key (JSON)", placeholder: "Paste your service account key JSON here", sensitive: true, multiline: true, provider: "vertex" },
];

export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();

    const [form, setForm] = useState<Record<string, string>>({});
    const [serverValues, setServerValues] = useState<Record<string, string> | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadSettings = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const res = await fetch("/api/settings");
            const json = (await res.json()) as { settings?: Record<string, string> | null };
            if (json.settings) {
                setServerValues(json.settings);
            }
        } catch {
            // Ignore load errors for new sessions
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading && user) void loadSettings();
        else if (!authLoading) setLoading(false);
    }, [authLoading, user, loadSettings]);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ settings: form }),
            });
            const json = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok) throw new Error(json.error ?? "Failed to save settings");
            setMessage({ type: "success", text: "Settings saved." });
            setForm({});
            await loadSettings();
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save" });
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        setMessage(null);
        try {
            await fetch("/api/settings", { method: "DELETE" });
            setServerValues(null);
            setForm({});
            setMessage({ type: "success", text: "Settings cleared." });
        } catch {
            setMessage({ type: "error", text: "Failed to clear settings" });
        }
    };

    const selectedProvider = form.llm_provider || serverValues?.llm_provider || "";

    return (
        <main className="flex flex-col gap-6">
            <header className="flex items-center justify-between border-b border-slate-200 pb-6 dark:border-slate-800">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
                    <p className="text-xs text-slate-500">Configure your integrations and credentials</p>
                </div>
                <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900">
                    Back to Dashboard
                </Link>
            </header>

            {!authLoading && !user ? (
                <section className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white/60 p-8 text-center dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Sign in to save your settings.
                    </p>
                    <Link
                        href="/login"
                        className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        Sign in
                    </Link>
                </section>
            ) : null}

            {user ? (
                <>
                    <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                        <div className="flex items-center gap-3">
                            <img
                                src={user.avatar_url}
                                alt=""
                                className="h-10 w-10 rounded-full"
                                referrerPolicy="no-referrer"
                            />
                            <div>
                                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {user.name ?? user.login}
                                </h2>
                                {user.email ? <p className="text-xs text-slate-500">{user.email}</p> : null}
                            </div>
                            <div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                GitHub connected
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">
                            Your GitHub token is used for API calls. LLM settings below are saved to your account.
                        </p>
                    </section>

                    {loading ? (
                        <p className="text-sm text-slate-500">Loading settings...</p>
                    ) : (
                        <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                            <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">LLM Configuration</h2>

                            <div className="flex flex-col gap-4">
                                {FIELDS.map((f) => {
                                    if (f.provider && selectedProvider && f.provider !== selectedProvider) return null;

                                    const serverVal = serverValues?.[f.key] ?? "";
                                    const formVal = form[f.key] ?? "";

                                    const inputCls = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600";

                                    return (
                                        <label key={f.key} className="flex flex-col gap-1">
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{f.label}</span>
                                            {f.multiline ? (
                                                <textarea
                                                    className={`${inputCls} resize-y font-mono text-xs`}
                                                    rows={4}
                                                    placeholder={serverVal ? `Current: ${serverVal}` : f.placeholder}
                                                    value={formVal}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                                />
                                            ) : (
                                                <input
                                                    type={f.sensitive ? "password" : "text"}
                                                    className={inputCls}
                                                    placeholder={serverVal ? `Current: ${serverVal}` : f.placeholder}
                                                    value={formVal}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                                />
                                            )}
                                        </label>
                                    );
                                })}
                            </div>

                            {message ? (
                                <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                                    message.type === "success"
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                                        : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
                                }`}>
                                    {message.text}
                                </div>
                            ) : null}

                            <div className="mt-6 flex items-center gap-3">
                                <button
                                    type="button"
                                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                    disabled={saving || Object.values(form).every((v) => !v.trim())}
                                    onClick={() => void handleSave()}
                                >
                                    {saving ? "Saving..." : "Save Settings"}
                                </button>
                                <button
                                    type="button"
                                    className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30"
                                    onClick={() => void handleClear()}
                                >
                                    Clear All
                                </button>
                            </div>
                        </section>
                    )}
                </>
            ) : null}

            {authLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
        </main>
    );
}
