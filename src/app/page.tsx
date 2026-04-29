import { Dashboard } from "@/components/Dashboard";
import { AiToggle } from "@/components/AiToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between border-b border-slate-200 pb-6 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <svg
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="36" height="36" rx="10" fill="url(#gt-bg)" />
            {/* Branch / track lines */}
            <path
              d="M12 8v10c0 2.2 1.8 4 4 4h4c2.2 0 4 1.8 4 4v2"
              stroke="url(#gt-branch)"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M12 18v10"
              stroke="#94a3b8"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.5"
            />
            {/* Nodes */}
            <circle cx="12" cy="8" r="2.5" fill="#34d399" />
            <circle cx="24" cy="28" r="2.5" fill="#22d3ee" />
            <circle cx="12" cy="28" r="2.5" fill="#94a3b8" opacity="0.6" />
            <defs>
              <linearGradient id="gt-bg" x1="0" y1="0" x2="36" y2="36">
                <stop stopColor="#0f172a" />
                <stop offset="1" stopColor="#1e293b" />
              </linearGradient>
              <linearGradient id="gt-branch" x1="12" y1="8" x2="24" y2="28">
                <stop stopColor="#34d399" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-slate-900 dark:text-slate-100">gi</span>
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Track
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              PR readiness, checks &amp; AI-assisted reviews
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AiToggle />
          <ThemeToggle />
        </div>
      </header>
      <Dashboard />
    </main>
  );
}
