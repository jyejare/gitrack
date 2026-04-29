"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
    theme: Theme;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "gitrack.theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>("dark");

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
            if (stored === "light" || stored === "dark") {
                setTheme(stored);
            } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
                setTheme("light");
            }
        } catch {
            // Ignore localStorage issues
        }
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // Ignore localStorage issues
        }
    }, [theme]);

    const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
    const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
    return ctx;
}
