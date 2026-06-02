"use client";

import { useMetrics } from "@/components/MetricsContext";

export function MetricsToggle() {
    const { metrics, toggleMetrics } = useMetrics();

    return (
        <button
            type="button"
            onClick={toggleMetrics}
            className={`group flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                metrics
                    ? "border-violet-600 bg-violet-50 text-violet-700 shadow-sm hover:bg-violet-100 dark:border-violet-500/60 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-950/70"
                    : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
            }`}
            aria-pressed={metrics}
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
                className={`transition-transform ${metrics ? "scale-110" : "group-hover:scale-105"}`}
            >
                <path d="M3 3v18h18" />
                <path d="M7 16l4-8 4 4 4-10" />
            </svg>
            <span>Metrics</span>
            <span
                className={`h-2 w-2 rounded-full transition-colors ${
                    metrics ? "bg-violet-500 dark:bg-violet-400" : "bg-slate-400 dark:bg-slate-600"
                }`}
            />
        </button>
    );
}
