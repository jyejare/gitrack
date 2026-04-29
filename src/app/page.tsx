import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-slate-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">GitHub PR Insights</h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Live readiness scores, checks, and review activity for a repository. LLM reviews run only when
          you ask for them; keys stay on the server.
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
