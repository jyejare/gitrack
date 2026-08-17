# giTrack

Next.js app for **engineering org visibility** into pull requests: **merge readiness scoring**, **CI checks + commit statuses**, **review summaries**, **PR size labels**, and **AI-powered review assistance** — including an "At a glance" code-focused summary and a structured Review Guide.

## Demo

https://github.com/user-attachments/assets/3610525f-c552-47ab-a0c9-b785b70a89ae

## Features

- **Readiness score** — 0–100 score with per-criteria breakdown (draft, merge conflicts, review status, CI checks, approvals)
- **PR size labels** — XS / S / M / L / XL / XXL based on lines changed
- **Mergeable indicators** — keyword tags (Clean, Conflict, Draft, CI failing, Changes requested, etc.)
- **At a glance** — AI-generated panel highlighting the key code changes with file paths, line numbers, and diff snippets
- **Review Guide** — AI-generated checklist, risk hotspots, and testing suggestions with color-coded sections
- **Full AI Review** — on-demand detailed PR review via the configured LLM, with inline code comments
- **Repo rules/skills** — reads `.cursorrules`, `.cursor/rules`, `.claude` rules/skills from the repository and includes them in AI reviews
- **Editable AI review** — edit the AI-generated review summary before submitting to GitHub
- **PR auto-assignment** — rule-based reviewer assignment by PR size (XS–XXL) and title keywords; configured per repo in Settings
- **Cross-repo search** — search by PR number or title text across all pages (uses GitHub Search API)
- **Repo bookmarks** — save and switch between frequently used repositories
- **Light / Dark mode** — toggle between themes; persists preference
- **AI Mode** — toggle AI features on/off from the header

## Supported LLM providers

| Provider | Configuration | Default model |
|----------|--------------|---------------|
| **Anthropic** | API key | `claude-3-5-sonnet-20241022` |
| **Vertex AI** | GCP project ID + Service Account key JSON | `claude-sonnet-4@20250514` |
| **Groq** | API key | `llama3-70b-8192` |
| **Ollama** | Host URL (local) | `llama3` |
| **vLLM** | Host URL + optional API key | Auto-detected from server |

All LLM credentials are configured per-user in the browser **Settings** page and stored in `localStorage`. They are transmitted to the server via a request header (`X-LLM-Settings`) per-request and **never persisted server-side**. No server-side secrets are required.

## Architecture — credential isolation

giTrack is designed for **multi-user deployments** where credential isolation is critical:

- **No `process.env` mutation** — credentials are passed explicitly via function parameters and `AsyncLocalStorage` (request-scoped). Concurrent requests cannot see each other's credentials.
- **No server-side credential storage** — LLM keys and GitHub tokens are stored only in the user's browser (`localStorage`).
- **Logout clears credentials** — signing out removes all stored LLM settings from the browser.
- **Missing credentials = clear error** — if no LLM provider is configured, the API returns a 422 with a message directing the user to Settings.

## Authentication

giTrack uses **GitHub Personal Access Tokens (PAT)** for authentication. Each user signs in with their own PAT, which is used for GitHub API calls.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) and create a **classic** or **fine-grained** token with `repo` read access.
2. Open giTrack and click **Sign in** (or navigate to `/login`).
3. Paste the token and click **Sign in**.

Your token is encrypted and stored in an HTTP-only cookie — it is never exposed to client-side JavaScript.

## Running locally

### Prerequisites

- **Node.js 20+** — install from [nodejs.org](https://nodejs.org)
- A **GitHub PAT** with repo read access (see [Authentication](#authentication))

### Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with your PAT, then enter a repository URL and click **Load PRs**.

To use AI features, go to **Settings** and configure an LLM provider.

### Using Ollama locally (no API key needed)

```bash
ollama serve
ollama pull llama3
```

Then in Settings, set **LLM Provider** to `ollama` and **Ollama Host** to `http://localhost:11434`.

## Using Vertex AI (Anthropic models via Google Cloud)

Vertex AI lets you run Anthropic Claude models through Google Cloud, which is useful when direct Anthropic API access is restricted or you want to use GCP billing.

### Step 1 — Create a GCP Service Account and key

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select (or create) a project that has the **Vertex AI API** enabled.
   - Navigate to **APIs & Services > Library**, search for **Vertex AI API**, and click **Enable** if it is not already enabled.
3. Go to **IAM & Admin > Service Accounts** and click **Create Service Account**.
   - Name: e.g. `gitrack-vertex`
   - Grant the role **Vertex AI User** (`roles/aiplatform.user`).
   - Click **Done**.
4. Open the newly created service account, go to the **Keys** tab, and click **Add Key > Create new key > JSON**.
5. A `.json` file is downloaded — this is your **Service Account key**. Keep it secure.

Alternatively, using the `gcloud` CLI:

```bash
gcloud iam service-accounts create gitrack-vertex \
  --display-name="giTrack Vertex AI"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gitrack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create sa-key.json \
  --iam-account=gitrack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Step 2 — Configure in giTrack Settings

1. Sign in to giTrack with your GitHub PAT.
2. Navigate to **Settings** (click your avatar → **Settings**).
3. Set **LLM Provider** to `vertex`.
4. Fill in **Vertex Project ID** with your GCP project ID.
5. Optionally set **Vertex Region** (default: `us-east5`) and **Vertex Model**.
   Models such as `claude-sonnet-5` and `claude-opus-4-8` are served on
   region `global`, not on a regional location (for example `us-east5`).
6. Paste the entire contents of your SA key `.json` file into the **Vertex SA Key (JSON)** field:

   ```json
   {
     "type": "service_account",
     "project_id": "my-gcp-project",
     "private_key": "<pem-private-key>",
     "client_email": "gitrack-vertex@my-gcp-project.iam.gserviceaccount.com"
   }
   ```
7. Click **Save Settings**.

The SA key is stored in your browser only and sent to the server per-request. It is never persisted on the server.

## Deploying on OpenShift

giTrack requires **zero server-side secrets** — all credentials are provided by users via the browser Settings page. This makes deployment simple.

### Prerequisites

- OpenShift cluster with `oc` CLI authenticated
- `oc` logged in with permissions to create Deployments, Routes, and Services

### 1. Deploy

```bash
oc new-project gitrack

oc apply -f openshift/deployment.yaml
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

That's it — no secrets, no PVCs, no environment variables to configure.

### 2. Verify

```bash
oc rollout status deployment/gitrack
oc get route gitrack -o jsonpath='https://{.spec.host}{"\n"}'
```

Open the printed URL in your browser. Sign in with your GitHub PAT, then go to **Settings** to configure your LLM provider.

### Updating

```bash
oc rollout restart deployment/gitrack
oc rollout status deployment/gitrack
```

New images are pulled automatically on restart (`imagePullPolicy: Always`).

### CI/CD — automatic image builds

A GitHub Action (`.github/workflows/publish-image.yml`) automatically builds and pushes a multi-arch (`amd64` + `arm64`) image to Quay.io when a new version tag (`v*`) is pushed:

```bash
git tag v0.4.0
git push origin v0.4.0
# → triggers build and push to quay.io/jyejare_redhat/gitrack:v0.4.0 + :latest
```

### OpenShift resource overview

| File | Resource | Purpose |
|------|----------|---------|
| `openshift/deployment.yaml` | Deployment | App pod with health probes, resource limits |
| `openshift/service.yaml` | Service | Internal ClusterIP service on port 3000 |
| `openshift/route.yaml` | Route | TLS-terminated edge route with 300s timeout |

### Troubleshooting

- **AI review returns 422** — The user has not configured an LLM provider in Settings. Go to Settings and set up a provider with credentials.
- **AI review times out (504)** — The route has a 300s (5 min) timeout via `haproxy.router.openshift.io/timeout`. Very large PRs may exceed this.
- **"Authentication required"** — The user is not signed in. Sign in with a GitHub PAT at `/login`.
- **Vertex AI "credentials" error** — The user must paste the full SA key JSON in Settings. See [Using Vertex AI](#using-vertex-ai-anthropic-models-via-google-cloud).
- **Image pull errors** — Ensure `quay.io/jyejare_redhat/gitrack` is set to public in Quay.io repository settings.
- **Exec format error** — The image was built for the wrong architecture. The CI builds both `amd64` and `arm64`. If building locally on Apple Silicon, use `docker buildx build --platform linux/amd64`.

## Usage

- **Load PRs** — enter a repository URL (e.g. `https://github.com/owner/repo`) and click **Load PRs**
- **Expand a row** (click ▸) — shows the AI "At a glance" and "Review Guide" panels (auto-generated when AI mode is on)
- **AI Review button** — runs a full LLM-powered PR review in a modal; edit the summary before submitting
- **Search** — type a PR number to jump to it, or text to search titles across the entire repo
- **Bookmark** — save frequently used repos for quick switching
- **Priority view / Sort** — filter by review-ready, blocked, draft, etc. and sort by readiness or update time
- **Light/Dark toggle** — sun/moon button in the top-right corner
- **AI Mode toggle** — enables/disables all AI features

## API routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/prs` | Paginated PR list with readiness, checks, reviews. Supports `search` param. |
| `POST` | `/api/review` | Full LLM PR review. Body: `{ owner, repo, number }` |
| `POST` | `/api/review/submit` | Submit review to GitHub. Body: `{ owner, repo, number, summary, verdict, comments }` |
| `POST` | `/api/insights` | Review Guide generation. Body: `{ owner, repo, number }` |
| `POST` | `/api/glance` | At-a-glance code summary. Body: `{ owner, repo, number }` |
| `GET` | `/api/repo-rules` | Fetch repository rules/skills. Params: `owner`, `repo`. |
| `GET` | `/api/metrics` | Repository metrics. Params: `owner`, `repo`, `days`. |
| `GET` | `/api/team` | List repo collaborators. Params: `owner`, `repo`. |
| `GET/POST/DELETE` | `/api/assignment-rules` | CRUD for per-repo PR auto-assignment rules. |
| `POST` | `/api/assign` | Evaluate assignment rules against PRs. Body: `{ owner, repo, pulls[] }` |

## How checks work

giTrack combines two GitHub status systems to match what you see on a PR page:

- **Check Runs** — from GitHub Actions / Apps (fetched from the base repo, not forks)
- **Commit Statuses** — from external CI integrations (GitBook, Jenkins, etc.)

Checks are deduplicated by name (re-runs keep only the latest), and skipped/neutral/cancelled runs are excluded from counts.

## License

MIT
