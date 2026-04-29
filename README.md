# giTrack

Next.js app for **engineering org visibility** into pull requests: **merge readiness scoring**, **CI checks + commit statuses**, **review summaries**, **PR size labels**, and **AI-powered review assistance** — including an "At a glance" code-focused summary and a structured Review Guide.

## Features

- **Readiness score** — 0–100 score with per-criteria breakdown (draft, merge conflicts, review status, CI checks, approvals)
- **PR size labels** — XS / S / M / L / XL / XXL based on lines changed
- **Mergeable indicators** — keyword tags (Clean, Conflict, Draft, CI failing, Changes requested, etc.)
- **At a glance** — AI-generated panel highlighting the key code changes with file paths, line numbers, and diff snippets
- **Review Guide** — AI-generated checklist, risk hotspots, and testing suggestions with color-coded sections
- **Full AI Review** — on-demand detailed PR review via the configured LLM
- **Cross-repo search** — search by PR number or title text across all pages (uses GitHub Search API)
- **Light / Dark mode** — toggle between themes; persists preference
- **AI Mode** — toggle AI features on/off from the header

## Supported LLM providers

| Provider | Key required | Notes |
|----------|-------------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Default model: `claude-3-5-sonnet-20241022` |
| **Groq** | `GROQ_API_KEY` | Default model: `llama3-70b-8192` |
| **Ollama** | None (local) | Default model: `llama3`, runs at `http://localhost:11434` |

## Local first run

1. Install **Node.js LTS** from [https://nodejs.org](https://nodejs.org).

2. Copy environment variables:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local`:

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `GITHUB_TOKEN` | Yes | Classic PAT or fine-grained token with repo read access |
   | `LLM_PROVIDER` | No | `anthropic`, `groq`, `ollama`, or unset for auto-detect |
   | `ANTHROPIC_API_KEY` | If using Anthropic | Server-side only |
   | `ANTHROPIC_MODEL` | No | Override the default Claude model |
   | `GROQ_API_KEY` | If using Groq | Server-side only |
   | `GROQ_MODEL` | No | Override the default Groq model |
   | `OLLAMA_HOST` | No | Ollama base URL (default: `http://localhost:11434`) |
   | `OLLAMA_MODEL` | No | Override the default Ollama model |

   **Using Ollama (no API key needed):**

   ```bash
   # Make sure Ollama is running with a model pulled
   ollama serve
   ollama pull llama3

   # Then set in .env.local:
   LLM_PROVIDER=ollama
   ```

4. Install and start:

   ```bash
   npm install
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), enter **Owner** and **Repo**, then click **Load PRs**.

## Usage

- **Load PRs** — fetches the paginated PR list with readiness scores, checks, and review status
- **Expand a row** (click ▸) — shows the AI "At a glance" and "Review Guide" panels (auto-generated when AI mode is on)
- **AI Review button** — runs a full LLM-powered PR review in a modal
- **Search** — type a PR number to jump to it, or text to search titles across the entire repo
- **Priority view / Sort** — filter by review-ready, blocked, draft, etc. and sort by readiness or update time
- **Light/Dark toggle** — sun/moon button in the top-right corner
- **AI Mode toggle** — enables/disables all AI features

## API routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/prs` | Paginated PR list with readiness, checks, reviews. Supports `search` param for cross-page search. |
| `POST` | `/api/review` | Full LLM PR review. Body: `{ owner, repo, number }` |
| `POST` | `/api/insights` | Review Guide generation. Body: `{ owner, repo, number }` |
| `POST` | `/api/glance` | At-a-glance code summary. Body: `{ owner, repo, number }` |

## How checks work

giTrack combines two GitHub status systems to match what you see on a PR page:

- **Check Runs** — from GitHub Actions / Apps (fetched from the base repo, not forks)
- **Commit Statuses** — from external CI integrations (GitBook, Jenkins, etc.)

Checks are deduplicated by name (re-runs keep only the latest), and skipped/neutral/cancelled runs are excluded from counts.



## License

MIT
