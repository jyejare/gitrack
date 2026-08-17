"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthContext";
import { loadLlmSettings, saveLlmSettings, clearLlmSettings, type LlmSettings } from "@/lib/client-settings";
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
    { key: "llm_provider", label: "LLM Provider", placeholder: "anthropic | groq | ollama | vertex | vllm", sensitive: false },
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
    { key: "vllm_host", label: "vLLM Host", placeholder: "http://localhost:8000", sensitive: false, provider: "vllm" },
    { key: "vllm_model", label: "vLLM Model", placeholder: "Model name served by vLLM", sensitive: false, provider: "vllm" },
    { key: "vllm_api_key", label: "vLLM API Key (optional)", placeholder: "API key if auth is enabled", sensitive: true, provider: "vllm" },
];

const PR_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
type PrSizeLabel = (typeof PR_SIZES)[number];

type AssignmentRule = {
    id: string;
    name: string;
    enabled: boolean;
    sizes: PrSizeLabel[];
    keywords: string[];
    reviewers: string[];
};

type TeamMember = { login: string; avatar_url: string };

function AssignmentRulesSection({ user }: { user: { login: string } }) {
    const [repoInput, setRepoInput] = useState("");
    const [activeRepo, setActiveRepo] = useState<{ owner: string; repo: string } | null>(null);
    const [team, setTeam] = useState<TeamMember[]>([]);
    const [teamLoading, setTeamLoading] = useState(false);
    const [rules, setRules] = useState<AssignmentRule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadRepoData = useCallback(async (owner: string, repo: string) => {
        setTeamLoading(true);
        setRulesLoading(true);
        setMessage(null);
        try {
            const [teamRes, rulesRes] = await Promise.all([
                fetch(`/api/team?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
                fetch(`/api/assignment-rules?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
            ]);
            if (!teamRes.ok) {
                const err = (await teamRes.json()) as { error?: string };
                throw new Error(err.error ?? "Failed to load team");
            }
            const teamJson = (await teamRes.json()) as { team: TeamMember[] };
            setTeam(teamJson.team);

            if (rulesRes.ok) {
                const rulesJson = (await rulesRes.json()) as { rules: AssignmentRule[] };
                setRules(rulesJson.rules);
            }
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to load repo data" });
        } finally {
            setTeamLoading(false);
            setRulesLoading(false);
        }
    }, []);

    const handleLoadRepo = () => {
        const parts = repoInput.trim().split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            setMessage({ type: "error", text: "Enter repo as owner/repo" });
            return;
        }
        const [owner, repo] = parts;
        setActiveRepo({ owner, repo });
        void loadRepoData(owner, repo);
    };

    const addRule = () => {
        setRules((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                name: `Rule ${prev.length + 1}`,
                enabled: true,
                sizes: [],
                keywords: [],
                reviewers: [],
            },
        ]);
    };

    const updateRule = (id: string, patch: Partial<AssignmentRule>) => {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const removeRule = (id: string) => {
        setRules((prev) => prev.filter((r) => r.id !== id));
    };

    const handleSaveRules = async () => {
        if (!activeRepo) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/assignment-rules", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ owner: activeRepo.owner, repo: activeRepo.repo, rules }),
            });
            const json = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok) throw new Error(json.error ?? "Failed to save rules");
            setMessage({ type: "success", text: "Assignment rules saved." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save rules" });
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600";

    return (
        <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
            <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">PR Auto-Assignment Rules</h2>
            <p className="mb-4 text-xs text-slate-500">
                Automatically assign reviewers to PRs based on size and keywords.
            </p>

            <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Repository</span>
                    <input
                        type="text"
                        className={inputCls}
                        placeholder="owner/repo"
                        value={repoInput}
                        onChange={(e) => setRepoInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleLoadRepo(); }}
                    />
                </label>
                <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                    onClick={handleLoadRepo}
                >
                    Load
                </button>
            </div>

            {(teamLoading || rulesLoading) && (
                <p className="mt-4 text-sm text-slate-500">Loading...</p>
            )}

            {activeRepo && !teamLoading && !rulesLoading && (
                <div className="mt-5 flex flex-col gap-4">
                    <div>
                        <h3 className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            Team Members ({team.length})
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {team.map((m) => (
                                <span key={m.login} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                                    <img src={m.avatar_url} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />
                                    {m.login}
                                </span>
                            ))}
                            {team.length === 0 && (
                                <span className="text-xs text-slate-400">No collaborators found</span>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-medium text-slate-600 dark:text-slate-400">Rules</h3>
                            <button
                                type="button"
                                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                                onClick={addRule}
                            >
                                + Add Rule
                            </button>
                        </div>

                        {rules.length === 0 && (
                            <p className="mt-3 text-xs text-slate-400">No rules yet. Add one to get started.</p>
                        )}

                        <div className="mt-3 flex flex-col gap-4">
                            {rules.map((rule) => (
                                <RuleCard
                                    key={rule.id}
                                    rule={rule}
                                    team={team}
                                    onUpdate={(patch) => updateRule(rule.id, patch)}
                                    onRemove={() => removeRule(rule.id)}
                                    inputCls={inputCls}
                                />
                            ))}
                        </div>
                    </div>

                    {message && (
                        <div className={`rounded-md border px-3 py-2 text-sm ${
                            message.type === "success"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                                : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
                        }`}>
                            {message.text}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                            disabled={saving}
                            onClick={() => void handleSaveRules()}
                        >
                            {saving ? "Saving..." : "Save Rules"}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

function RuleCard({
    rule,
    team,
    onUpdate,
    onRemove,
    inputCls,
}: {
    rule: AssignmentRule;
    team: TeamMember[];
    onUpdate: (patch: Partial<AssignmentRule>) => void;
    onRemove: () => void;
    inputCls: string;
}) {
    const [keywordInput, setKeywordInput] = useState("");

    const addKeyword = () => {
        const kw = keywordInput.trim();
        if (kw && !rule.keywords.includes(kw)) {
            onUpdate({ keywords: [...rule.keywords, kw] });
        }
        setKeywordInput("");
    };

    const removeKeyword = (kw: string) => {
        onUpdate({ keywords: rule.keywords.filter((k) => k !== kw) });
    };

    const sizes = rule.sizes ?? [];

    const toggleSize = (size: PrSizeLabel) => {
        if (sizes.includes(size)) {
            onUpdate({ sizes: sizes.filter((s) => s !== size) });
        } else {
            onUpdate({ sizes: [...sizes, size] });
        }
    };

    const toggleReviewer = (login: string) => {
        if (rule.reviewers.includes(login)) {
            onUpdate({ reviewers: rule.reviewers.filter((r) => r !== login) });
        } else {
            onUpdate({ reviewers: [...rule.reviewers, login] });
        }
    };

    return (
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
                <input
                    type="text"
                    className={`${inputCls} flex-1 font-medium`}
                    value={rule.name}
                    onChange={(e) => onUpdate({ name: e.target.value })}
                />
                <label className="flex items-center gap-1.5 text-xs">
                    <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => onUpdate({ enabled: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    Enabled
                </label>
                <button
                    type="button"
                    className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={onRemove}
                    title="Remove rule"
                >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">PR sizes (empty = match all sizes)</span>
                <div className="mt-2 flex flex-wrap gap-2">
                    {PR_SIZES.map((size) => {
                        const selected = sizes.includes(size);
                        return (
                            <button
                                key={size}
                                type="button"
                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    selected
                                        ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:border-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300"
                                        : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                                }`}
                                onClick={() => toggleSize(size)}
                            >
                                {size}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">Keywords (matches PR title)</span>
                <div className="mt-1 flex items-center gap-2">
                    <input
                        type="text"
                        className={`${inputCls} flex-1`}
                        placeholder="Add keyword..."
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                    />
                    <button
                        type="button"
                        className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                        onClick={addKeyword}
                    >
                        Add
                    </button>
                </div>
                {rule.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {rule.keywords.map((kw) => (
                            <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                                {kw}
                                <button type="button" onClick={() => removeKeyword(kw)} className="hover:text-cyan-900 dark:hover:text-cyan-100">&times;</button>
                            </span>
                        ))}
                    </div>
                )}
                {rule.keywords.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">No keywords = matches any PR title</p>
                )}
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">Assign to reviewers</span>
                <div className="mt-2 flex flex-wrap gap-2">
                    {team.map((m) => {
                        const selected = rule.reviewers.includes(m.login);
                        return (
                            <button
                                key={m.login}
                                type="button"
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                    selected
                                        ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                                }`}
                                onClick={() => toggleReviewer(m.login)}
                            >
                                <img src={m.avatar_url} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />
                                {m.login}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();

    const [form, setForm] = useState<Record<string, string>>({});
    const [savedValues, setSavedValues] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const reloadFromStorage = useCallback(() => {
        const stored = loadLlmSettings();
        const asRecord: Record<string, string> = {};
        for (const [k, v] of Object.entries(stored)) {
            if (typeof v === "string" && v) asRecord[k] = v;
        }
        setSavedValues(asRecord);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (!authLoading) reloadFromStorage();
    }, [authLoading, reloadFromStorage]);

    const handleSave = () => {
        setMessage(null);
        const merged = { ...savedValues } as Record<string, string>;
        for (const [k, v] of Object.entries(form)) {
            if (v.trim()) merged[k] = v.trim();
        }
        saveLlmSettings(merged as LlmSettings);
        setForm({});
        reloadFromStorage();
        setMessage({ type: "success", text: "Settings saved to your browser." });
    };

    const handleClear = () => {
        setMessage(null);
        clearLlmSettings();
        setSavedValues({});
        setForm({});
        setMessage({ type: "success", text: "Settings cleared." });
    };

    function maskKey(key: string | undefined): string {
        if (!key) return "";
        if (key.length <= 8) return "****";
        return key.slice(0, 4) + "…" + key.slice(-4);
    }

    const selectedProvider = form.llm_provider || savedValues.llm_provider || "";

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
                            Your GitHub token is used for API calls. LLM settings below are stored in your browser only and never saved on the server.
                        </p>
                    </section>

                    {loading ? (
                        <p className="text-sm text-slate-500">Loading settings...</p>
                    ) : (
                        <>
                            <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                                <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">LLM Configuration</h2>

                                <div className="flex flex-col gap-4">
                                    {FIELDS.map((f) => {
                                        if (f.provider && selectedProvider && f.provider !== selectedProvider) return null;

                                        const currentVal = savedValues[f.key] ?? "";
                                        const displayVal = f.sensitive && currentVal ? `Current: ${maskKey(currentVal)}` : (currentVal || f.placeholder);
                                        const formVal = form[f.key] ?? "";

                                        const inputCls = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600";

                                        return (
                                            <label key={f.key} className="flex flex-col gap-1">
                                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{f.label}</span>
                                                {f.multiline ? (
                                                    <textarea
                                                        className={`${inputCls} resize-y font-mono text-xs`}
                                                        rows={4}
                                                        placeholder={displayVal}
                                                        value={formVal}
                                                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                                    />
                                                ) : (
                                                    <input
                                                        type={f.sensitive ? "password" : "text"}
                                                        className={inputCls}
                                                        placeholder={displayVal}
                                                        value={formVal}
                                                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                                    />
                                                )}
                                            </label>
                                        );
                                    })}
                                </div>

                                {selectedProvider === "vertex" ? (
                                    <p className="mt-3 text-xs text-slate-500">
                                        Newer Claude models (Sonnet 5, Opus 4.8, …) are served on region <span className="font-mono">global</span>, not on a regional location such as <span className="font-mono">us-east5</span>. Example model id: <span className="font-mono">claude-sonnet-5</span>.
                                    </p>
                                ) : null}

                                {message ? (
                                    <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                                        message.type === "success"
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                                            : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
                                    }`}>
                                        {message.text}
                                    </div>
                                ) : null}

                                <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                                    Settings are stored in this browser&apos;s localStorage. They are never sent to or saved on the server.
                                </p>

                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        type="button"
                                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                                        disabled={Object.values(form).every((v) => !v.trim())}
                                        onClick={handleSave}
                                    >
                                        Save Settings
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30"
                                        onClick={handleClear}
                                    >
                                        Clear All
                                    </button>
                                </div>
                            </section>

                            <AssignmentRulesSection user={user} />
                        </>
                    )}
                </>
            ) : null}

            {authLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
        </main>
    );
}
