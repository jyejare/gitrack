# giTrack

Next.js app for **engineering org visibility** into pull requests: **merge readiness scoring**, **CI checks + commit statuses**, **review summaries**, **PR size labels**, and **AI-powered review assistance** — including an "At a glance" code-focused summary and a structured Review Guide.

## Demo

<video src="https://github.com/jyejare/gitrack/raw/refs/heads/main/assets/demo.mp4" width="100%" autoplay muted loop></video>

## Features

- **Readiness score** — 0–100 score with per-criteria breakdown (draft, merge conflicts, review status, CI checks, approvals)
- **PR size labels** — XS / S / M / L / XL / XXL based on lines changed
- **Mergeable indicators** — keyword tags (Clean, Conflict, Draft, CI failing, Changes requested, etc.)
- **At a glance** — AI-generated panel highlighting the key code changes with file paths, line numbers, and diff snippets
- **Review Guide** — AI-generated checklist, risk hotspots, and testing suggestions with color-coded sections
- **Full AI Review** — on-demand detailed PR review via the configured LLM
- **PR auto-assignment** — rule-based reviewer assignment by PR size (XS–XXL) and title keywords; configured per repo in Settings
- **Cross-repo search** — search by PR number or title text across all pages (uses GitHub Search API)
- **Light / Dark mode** — toggle between themes; persists preference
- **AI Mode** — toggle AI features on/off from the header

## Supported LLM providers

| Provider | Key required | Notes |
|----------|-------------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Default model: `claude-3-5-sonnet-20241022` |
| **Vertex AI** | GCP credentials (ADC) | Anthropic models via Google Cloud. Default model: `claude-sonnet-4@20250514` |
| **Groq** | `GROQ_API_KEY` | Default model: `llama3-70b-8192` |
| **Ollama** | None (local) | Default model: `llama3`, runs at `http://localhost:11434` |

## Authentication

giTrack uses **GitHub Personal Access Tokens (PAT)** for authentication. Each user signs in with their own PAT, which is used for GitHub API calls and to persist per-user settings (LLM provider, model, API keys).

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) and create a **classic** or **fine-grained** token with `repo` read access.
2. Open giTrack and click **Sign in** (or navigate to `/login`).
3. Paste the token and click **Sign in with Token**.

Your token is encrypted and stored in an HTTP-only cookie — it is never exposed to client-side JavaScript.

## Running locally

### Prerequisites

- **Node.js 20+** — install from [nodejs.org](https://nodejs.org)
- A **GitHub PAT** with repo read access (see [Authentication](#authentication))

### Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with your PAT, enter **Owner** and **Repo**, then click **Load PRs**.

### Environment variables

Edit `.env.local` to configure defaults. Individual users can override most of these via the **Settings** page after signing in.

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | No | Fallback token when no user is signed in |
| `LLM_PROVIDER` | No | `anthropic`, `vertex`, `groq`, `ollama`, or unset for auto-detect |
| `ANTHROPIC_API_KEY` | If using Anthropic | Server-side only |
| `ANTHROPIC_MODEL` | No | Override the default Claude model |
| `VERTEX_PROJECT_ID` | If using Vertex AI | GCP project ID |
| `VERTEX_REGION` | No | GCP region (default: `us-east5`) |
| `VERTEX_MODEL` | No | Override the default Vertex AI model |
| `GROQ_API_KEY` | If using Groq | Server-side only |
| `GROQ_MODEL` | No | Override the default Groq model |
| `OLLAMA_HOST` | No | Ollama base URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | Override the default Ollama model |
| `SETTINGS_ENCRYPTION_KEY` | Recommended | 64-char hex key for encrypting user settings at rest. Generate with `openssl rand -hex 32` |

### Using Ollama locally (no API key needed)

```bash
ollama serve
ollama pull llama3

# .env.local
LLM_PROVIDER=ollama
```

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
# Create the service account
gcloud iam service-accounts create gitrack-vertex \
  --display-name="giTrack Vertex AI"

# Grant Vertex AI User role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:gitrack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Generate the JSON key file
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=gitrack-vertex@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### Step 2a — Local development

For local development you can use Application Default Credentials (ADC) — no SA key file needed:

```bash
gcloud auth application-default login

# .env.local
LLM_PROVIDER=vertex
VERTEX_PROJECT_ID=my-gcp-project
# VERTEX_REGION=us-east5        # optional, defaults to us-east5
# VERTEX_MODEL=claude-sonnet-4@20250514  # optional
```

Or point to the SA key file directly:

```bash
# .env.local
LLM_PROVIDER=vertex
VERTEX_PROJECT_ID=my-gcp-project
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
```

### Step 2b — Configure via the giTrack UI (recommended for deployed environments)

When giTrack is deployed on OpenShift or another server where `gcloud auth` is not available, users can paste their SA key JSON directly in the app:

1. Sign in to giTrack with your GitHub PAT.
2. Navigate to **Settings** (click your avatar in the top-right, then **Settings**).
3. Set **LLM Provider** to `vertex`.
4. Fill in **Vertex Project ID** with your GCP project ID.
5. Optionally set **Vertex Region** (default: `us-east5`) and **Vertex Model**.
6. Paste the entire contents of your SA key `.json` file into the **Vertex SA Key (JSON)** field.
7. Click **Save Settings**.

giTrack securely writes the SA key to a temporary file on the server for the duration of each request and cleans it up afterwards. The key is encrypted at rest alongside your other settings.

## Deploying on OpenShift (Admin Guide)

### Prerequisites

- OpenShift cluster with `oc` CLI authenticated
- A project/namespace created (e.g. `oc new-project gitrack`)
- Cluster permissions to create Deployments, Routes, PVCs, and Secrets

### 1. Create the namespace and apply manifests

```bash
oc new-project gitrack   # or: oc project gitrack

# Apply all OpenShift resources
oc apply -f openshift/secret.yaml
oc apply -f openshift/deployment.yaml   # also creates the PVC
oc apply -f openshift/service.yaml
oc apply -f openshift/route.yaml
```

### 2. Configure the Secret

Edit the `gitrack-config` secret with your environment values:

```bash
oc edit secret gitrack-config
```

Key fields to set:

| Key | Required | Description |
|-----|----------|-------------|
| `LLM_PROVIDER` | Yes | Default LLM provider (`anthropic`, `vertex`, `groq`, `ollama`) |
| `SETTINGS_ENCRYPTION_KEY` | Yes | 64-char hex key for encrypting user settings. Generate with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | If Anthropic | Default API key (users can override via Settings) |
| `GROQ_API_KEY` | If Groq | Default API key |
| `VERTEX_PROJECT_ID` | If Vertex | Default GCP project ID |
| `VERTEX_REGION` | If Vertex | GCP region (default: `us-east5`) |

The `GITHUB_TOKEN` field can be left empty — each user provides their own PAT when signing in. Similarly, LLM keys set in the secret serve as defaults; individual users can override them in their Settings page.

### 3. Container image

The deployment manifest is pre-configured to use the Quay.io image:

```
quay.io/jyejare_redhat/gitrack:latest
```

This is the recommended approach — no BuildConfig or internal registry setup required. Simply apply the manifests and the deployment will pull the image from Quay.

#### Alternative: Build your own image

If you need a custom build (e.g. local patches or a private fork), you can use an OpenShift binary build instead:

```bash
oc new-build --binary --strategy=docker --name=gitrack
oc start-build gitrack --from-dir=. --follow

# Point the deployment to the internal registry image
oc set image deployment/gitrack \
  gitrack=$(oc get is gitrack -o jsonpath='{.status.dockerImageRepository}'):latest
```

### 4. Verify the rollout

```bash
oc rollout status deployment/gitrack
oc get route gitrack -o jsonpath='https://{.spec.host}{"\n"}'
```

Open the printed URL in your browser. Sign in with your GitHub PAT.

### Updating

When using the Quay image, redeployments happen automatically when a new image is pushed (due to `imagePullPolicy: Always`):

```bash
oc rollout restart deployment/gitrack
oc rollout status deployment/gitrack
```

If using a custom build:

```bash
oc start-build gitrack --from-dir=. --follow
oc rollout restart deployment/gitrack
oc rollout status deployment/gitrack
```

### OpenShift resource overview

| File | Resource | Purpose |
|------|----------|---------|
| `openshift/secret.yaml` | Secret `gitrack-config` | Environment variables (LLM keys, encryption key) |
| `openshift/deployment.yaml` | Deployment + PVC | App pod with 1Gi persistent volume at `/app/.data` for user settings and temp files |
| `openshift/service.yaml` | Service | Internal ClusterIP service on port 3000 |
| `openshift/route.yaml` | Route | TLS-terminated edge route with 300s timeout (for long-running AI reviews) |

### Troubleshooting

- **AI review times out** — The route has a 300s (5 min) timeout. Very large PRs may still exceed this. Check pod logs with `oc logs deployment/gitrack`.
- **"GITHUB_TOKEN not set"** — Ensure users are signed in. The user's PAT is injected per-request from their session cookie.
- **Settings not persisting** — Verify the PVC is mounted and writable: `oc exec deployment/gitrack -- ls -la /app/.data`.
- **Vertex AI "credentials" error** — Users must paste the full SA key JSON in Settings. See [Using Vertex AI](#using-vertex-ai-anthropic-models-via-google-cloud) for how to obtain the key.

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
| `GET` | `/api/metrics` | Repository metrics (merge time, review turnaround, PR sizes). Params: `owner`, `repo`, `days`. |
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
