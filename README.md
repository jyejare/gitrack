# GitHub PR Insights

Next.js app for **engineering org visibility** into pull requests: **merge readiness score**, **checks**, **ACK-style review summary**, **comment counts**, and **on-demand LLM reviews/insights**. Stats load when you open a repo slice; LLM reviews run only when a user clicks the review action.

## Local first run

1. Install **Node.js LTS** from [https://nodejs.org](https://nodejs.org) so you have `npm` on your PATH (the Cursor-bundled `node.exe` alone is not enough).

2. Copy environment variables:

   ```bash
   copy .env.example .env.local
   ```

   On macOS or Linux, use `cp .env.example .env.local` instead.

3. Fill in `.env.local`:

   - **`GITHUB_TOKEN`**: classic PAT or fine-grained token with read access to the repos you care about (`repo` for private repos, `read:org` if you need org metadata elsewhere later).
   - **`ANTHROPIC_API_KEY`**: server-side Anthropic key used only by API routes (never sent to the browser).
   - Optional **`ANTHROPIC_MODEL`**: defaults to `claude-3-5-sonnet-20241022` in code; set this if your org standardizes on another Claude snapshot.
   - Optional **`GROQ_API_KEY`**: server-side Groq key used only by API routes.
   - Optional **`GROQ_MODEL`**: defaults to `llama3-70b-8192`.
   - Optional **`LLM_PROVIDER`**: `anthropic`, `groq`, or unset for auto-detect (Groq if configured, otherwise Anthropic).

4. Install and start:

   ```bash
   npm install
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), enter **owner** and **repo**, then **Load PRs**. Use **Next / Prev** for pagination. **AI review** fetches the diff and calls the configured LLM once per click.

## How this maps to “org rollout”

### GitHub access models

| Approach | Best for | Notes |
|----------|-----------|--------|
| **Shared PAT in server env** (this v1) | Solo / internal pilot on your laptop or a single shared demo host | Easiest; token is powerful—treat `.env.local` / deployment secrets like production credentials. |
| **Per-user OAuth (GitHub App or OAuth App)** | Real multi-user product | Each user signs in; the server stores **per-user access tokens** (encrypted) and calls GitHub as that user. Fits “anyone sees repos they can access.” |
| **GitHub App (installation token)** | Org-wide automation without a human PAT | Install the app on `your-org`; backend exchanges JWT for **installation tokens** scoped to repos you select. Great for scheduled sync jobs and uniform access. |

For **reviews**, nothing about GitHub App vs OAuth changes the LLM side: the server still needs the configured **LLM provider credential** (Anthropic or Groq; set via env).

### LLM providers

- **Org standard (recommended for production)**: one LLM API key in your deployment platform (Anthropic or Groq). All reviews share org quota; you audit centrally.
- **Per-engineer keys**: possible but usually worse operationally (key rotation, leakage from laptops, no central audit). If you need it, add an encrypted-at-rest column and a settings UI—out of scope for this first version.

### Suggested production hardening (later)

- Replace shared `GITHUB_TOKEN` with **session + OAuth** or **GitHub App**.
- Add org SSO in front of the app (Okta, Google Workspace, etc.) if it is internal-only.
- Rate-limit `/api/review`, cap diff size (already truncated server-side), and log PR numbers without storing full diffs.

## API routes

- `GET /api/prs?owner=&repo=&page=&perPage=&state=open|closed|all` — hydrated PR rows with readiness and checks.
- `POST /api/review` with JSON `{ "owner", "repo", "number" }` — returns `{ markdown, model }` from the configured LLM provider.

## License

MIT
