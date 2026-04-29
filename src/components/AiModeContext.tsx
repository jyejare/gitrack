"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AiModeContextValue = {
  aiMode: boolean;
  setAiMode: (next: boolean) => void;
  toggleAiMode: () => void;
};

const AiModeContext = createContext<AiModeContextValue | null>(null);

const STORAGE_KEY = "gitrack.aiMode";

export function AiModeProvider({ children }: { children: React.ReactNode }) {
  const [aiMode, setAiModeState] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "true") setAiModeState(true);
      if (raw === "false") setAiModeState(false);
    } catch {
      // Ignore localStorage issues (private mode, blocked storage, etc.)
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ai-mode", aiMode);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(aiMode));
    } catch {
      // Ignore localStorage issues
    }
  }, [aiMode]);

  const setAiMode = useCallback((next: boolean) => setAiModeState(next), []);
  const toggleAiMode = useCallback(() => setAiModeState((v) => !v), []);

  const value = useMemo(() => ({ aiMode, setAiMode, toggleAiMode }), [aiMode, setAiMode, toggleAiMode]);
  return <AiModeContext.Provider value={value}>{children}</AiModeContext.Provider>;
}

export function useAiMode() {
  const ctx = useContext(AiModeContext);
  if (!ctx) throw new Error("useAiMode must be used within an AiModeProvider");
  return ctx;
}

