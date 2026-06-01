"use client";

import { useAdvancedUi } from "@/components/AdvancedUiContext";

export function AdvancedUiToggle() {
    const { advancedUi, toggleAdvancedUi } = useAdvancedUi();

    return (
        <button
            type="button"
            onClick={toggleAdvancedUi}
            className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                advancedUi
                    ? "border-violet-600 bg-violet-50 text-violet-700 shadow-sm hover:bg-violet-100 dark:border-violet-500/60 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-950/70"
                    : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
            }`}
            aria-pressed={advancedUi}
        >
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${advancedUi ? "scale-110" : "group-hover:scale-105"}`}
            >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span>Advanced UI</span>
            <span
                className={`h-2 w-2 rounded-full transition-colors ${
                    advancedUi ? "bg-violet-500 dark:bg-violet-400" : "bg-slate-400 dark:bg-slate-600"
                }`}
            />
        </button>
    );
}
