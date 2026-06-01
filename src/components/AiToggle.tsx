"use client";

import { useAiMode } from "@/components/AiModeContext";

export function AiToggle() {
    const { aiMode, toggleAiMode } = useAiMode();

    return (
        <button
            type="button"
            onClick={toggleAiMode}
            className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                aiMode
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-200 dark:shadow-[0_0_12px_rgba(52,211,153,0.15)] dark:hover:bg-emerald-950/70"
                    : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
            }`}
            aria-pressed={aiMode}
        >
            {/* AI sparkle icon */}
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={`transition-transform ${aiMode ? "scale-110" : "group-hover:scale-105"}`}
            >
                <path
                    d="M12 2L13.5 8.5L20 7L14.5 11L18 17L12 13.5L6 17L9.5 11L4 7L10.5 8.5L12 2Z"
                    fill={aiMode ? "url(#ai-grad)" : "currentColor"}
                    stroke={aiMode ? "#059669" : "currentColor"}
                    strokeWidth="1"
                    strokeLinejoin="round"
                />
                <circle cx="12" cy="10" r="2" fill={aiMode ? "#0891b2" : "currentColor"} opacity="0.8" />
                <defs>
                    <linearGradient id="ai-grad" x1="4" y1="2" x2="20" y2="17">
                        <stop stopColor="#34d399" />
                        <stop offset="1" stopColor="#22d3ee" />
                    </linearGradient>
                </defs>
            </svg>
            <span>AI Mode</span>
            <span
                className={`h-2 w-2 rounded-full transition-colors ${
                    aiMode ? "bg-emerald-500 dark:bg-emerald-400 dark:shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-slate-400 dark:bg-slate-600"
                }`}
            />
        </button>
    );
}
