"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AdvancedUiContextValue = {
    advancedUi: boolean;
    setAdvancedUi: (next: boolean) => void;
    toggleAdvancedUi: () => void;
};

const AdvancedUiContext = createContext<AdvancedUiContextValue | null>(null);

const STORAGE_KEY = "gitrack.advancedUi";

export function AdvancedUiProvider({ children }: { children: React.ReactNode }) {
    const [advancedUi, setAdvancedUiState] = useState(false);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw === "true") setAdvancedUiState(true);
        } catch {
            // Ignore localStorage issues
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, String(advancedUi));
        } catch {
            // Ignore localStorage issues
        }
    }, [advancedUi]);

    const setAdvancedUi = useCallback((next: boolean) => setAdvancedUiState(next), []);
    const toggleAdvancedUi = useCallback(() => setAdvancedUiState((v) => !v), []);

    const value = useMemo(
        () => ({ advancedUi, setAdvancedUi, toggleAdvancedUi }),
        [advancedUi, setAdvancedUi, toggleAdvancedUi],
    );
    return <AdvancedUiContext.Provider value={value}>{children}</AdvancedUiContext.Provider>;
}

export function useAdvancedUi() {
    const ctx = useContext(AdvancedUiContext);
    if (!ctx) throw new Error("useAdvancedUi must be used within an AdvancedUiProvider");
    return ctx;
}
