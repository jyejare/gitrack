"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type MetricsContextValue = {
    metrics: boolean;
    setMetrics: (next: boolean) => void;
    toggleMetrics: () => void;
};

const MetricsCtx = createContext<MetricsContextValue | null>(null);

const STORAGE_KEY = "gitrack.metrics";

export function MetricsProvider({ children }: { children: React.ReactNode }) {
    const [metrics, setMetricsState] = useState(false);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw === "true") setMetricsState(true);
        } catch {
            // Ignore localStorage issues
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, String(metrics));
        } catch {
            // Ignore localStorage issues
        }
    }, [metrics]);

    const setMetrics = useCallback((next: boolean) => setMetricsState(next), []);
    const toggleMetrics = useCallback(() => setMetricsState((v) => !v), []);

    const value = useMemo(
        () => ({ metrics, setMetrics, toggleMetrics }),
        [metrics, setMetrics, toggleMetrics],
    );
    return <MetricsCtx.Provider value={value}>{children}</MetricsCtx.Provider>;
}

export function useMetrics() {
    const ctx = useContext(MetricsCtx);
    if (!ctx) throw new Error("useMetrics must be used within a MetricsProvider");
    return ctx;
}
