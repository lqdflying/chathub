# LobeHub

> A self-hosted, production-ready AI chat platform — built on [LobeChat](https://github.com/lobehub/lobe-chat), significantly extended for real-world self-hosted deployments.

LobeHub diverged from LobeChat at v3.0.0 and is maintained independently. It ships as a single Docker image targeting PostgreSQL deployments, adds built-in authentication that requires no external OAuth service, ships a broader model bank, and includes utility tools not present upstream.

---

## What's Different from Upstream LobeChat

| Area | Upstream LobeChat | LobeHub |
| ---- | ----------------- | ------- |
| Deployment target | Vercel / Docker / Desktop | Docker + PostgreSQL only |
| Versioning | v1.x | v3.x (independent) |
| Browser login (no OAuth) | ❌ Not supported | ✅ Username/password or token login page built-in |
| Model bank | Upstream releases | Extended: Claude 4.x, GPT-5.x, Gemini 3.x, Kimi K2.x, MiniMax |
| Tools Hub | ❌ Not present | ✅ Built-in (Picbed, API Tester + extensible sidebar) |
| Picbed | ❌ Not present | ✅ Image hosting with S3, auto URL copy |
| API Tester | ❌ Not present | ✅ Browser-based REST API client at `/tools/apitest` |
| Changelog page | Enabled | Disabled (skips external fetch at build time) |
| Topic memory / context UX | Basic rolling summary | Assistance presets, token auto-compact, manual compact, daily opt-in, debug log, optional archives, **assistant-level memory** (`agents.assistant_memory`) with manual or periodic LLM rollup from topic summaries across sessions linked to the same agent |

---

## Features

### Core (inherited from LobeChat)

- Multi-model chat — OpenAI, Anthropic, Google, Moonshot/Kimi, MiniMax, **OpenAI-compatible (custom URL + API key + models)**, Ollama, and 40+ providers
- Knowledge base with RAG (file upload, chunking, vector search)
- MCP plugin system with one-click installation
- Multi-user management with NextAuth / OIDC / Clerk
- AI image generation (DALL-E, GPT-Image, Gemini Image)
- Chain-of-thought, branching conversations, artifacts support
- TTS / STT voice conversation
- Real-time search integration

### LobeHub Additions

- **Built-in credentials login** — username/password or token login page, no external OAuth service needed:
  - Password mode: set `AUTH_CREDENTIALS_USERNAME` + `AUTH_CREDENTIALS_PASSWORD`
  - Token mode: set `AUTH_TOKEN` (also works for API Bearer auth)
  - Both can be enabled simultaneously; can be combined with OAuth providers on the same login page
  - Upstream LobeChat only supports OAuth — credentials login is unique to LobeHub
- **Tools Hub** — dedicated left-sidebar section (Wrench icon) for utility tools, with its own sub-navigation panel
- **Picbed** — image hosting tool at `/tools/picbed`:
  - Upload via paste, drag-and-drop, or file select
  - Auto-copies URL to clipboard on upload
  - Paginated grid view (20 per page) with timestamps
  - S3-backed storage
- **API Tester** — REST API client at `/tools/apitest`:
  - All HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
  - Auth: None / Bearer Token / Basic Auth
  - Request headers editor, body editor with JSON formatter
  - Response viewer with status code, timing, pretty-printed JSON, raw toggle
  - Stateless — no database required
- **Extended model bank** — latest Claude (4.5, 4.6 Opus), GPT-5.x series (5.1, 5.2, 5.3, 5.4 / pro / chat / codex / mini / nano), Gemini 3.x (pro, flash), Kimi K2.x (k2.5, k2-thinking, k2-turbo), MiniMax with accurate pricing
- **Memory and context compaction** — assistance-level presets, optional **token-threshold auto compact**, **manual compact** from the token popover, optional **daily** topic refresh (client + `localStorage`), **compaction debug** on the active topic, optional **memory archive** excerpts on the topic and in prompts when enabled. **Assistant memory** (cross-session notes on the agent row) can be edited manually or **generated/merged** from topic compaction summaries (button in **Assistant → Memory**), with an optional **once-per-UTC-day-per-agent** periodic merge. Topic compaction and assistant rollup both use **Settings → System Agent → history compress** for model calls. Details: [Memory and context compaction](#memory-and-context-compaction).

---

## Memory and context compaction

LobeHub separates **topic-level compaction** from **assistant-level memory**:

### Topic compaction (per topic / “session thread”)

Per-topic **history summary** (`topics.history_summary`) is produced by the compaction pipeline:

- **Assistant → Chat** includes a **Memory & context** group: assistance level (minimal / balanced / rich), history limits, **auto summary**, **token auto-compact** with configurable **threshold** (default 0.8 of estimated context), **daily topic note** (opt-in), and **memory archive** snapshots. Below the form, preview the **active topic** compaction text, copy, or export as Markdown.
- **Manual compact** — button in the token popover runs the same summarization path when history limits and compression are enabled.
- **Token auto-compact** — background check uses the **same local token estimate** as the token tag; when the ratio exceeds your threshold, older turns are summarized (cooldown avoids loops). Figures are **estimates**, not provider billing tokens.
- **Daily run** — once per UTC calendar day per session+topic key in browser storage, if enabled (topic compaction only).
- **Debug panel** — after compaction, metadata stores a short log (`memoryDebugLog`) you can expand in the conversation chrome.
- **Archives** — optional excerpts appended under the history summary block sent to the model when **memory archive** is on.

### Assistant memory (per agent, cross-session)

- Stored on the agent row as **`assistant_memory`** (see migration `0043_add_agent_assistant_memory.sql`). Injected into chat context **before** the active topic’s compaction block (combined in the history-summary channel).
- **Manual rollup** — **Assistant → Memory** → “Generate assistant memory from topics” calls the system history-compress model to merge **prior assistant memory** with **non-empty topic `historySummary` rows** from **all sessions linked to this `agentId`** (`agents_to_sessions` join), then overwrites the assistant memory field (confirm dialog).
- **Periodic rollup** — optional switch **Periodic assistant memory merge**: at most **once per UTC day per agent** (browser `localStorage`), same merge as manual when AI is not generating.
- Rollup **requires** topics to already have compaction summaries; topics without `historySummary` are skipped.

PostgreSQL `user_memories` schema exists for future cross-session vector memory; current behavior uses **topic metadata** for archives and prompt injection, and **agents.assistant_memory** for editable / rollup assistant notes.

---

## Quick Start (Docker Compose)

```yaml
services:
  lobe-chat:
    image: docker.io/lqdflying/lobehub:latest
    depends_on:
      lobe-db:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://user:password@lobe-db:5432/postgres
      - DATABASE_DRIVER=node
      - KEY_VAULTS_SECRET=<your-secret>
      - NEXTAUTH_SECRET=<your-secret>
      - NEXTAUTH_URL=https://your-domain.com
      # LLM API keys — see "LLM provider environment variables" for per-provider examples:
      # OPENAI_API_KEY=...
      # ANTHROPIC_API_KEY=...
      # MOONSHOT_API_KEY=... (for Kimi K2.x models)
      # MINIMAX_API_KEY=...
      # OpenAI-compatible gateway (vLLM, LiteLLM, local APIs, etc.):
      # OPENAICOMPATIBLE_API_KEY=...
      # OPENAICOMPATIBLE_PROXY_URL=https://your-host/v1
      # Optional: seed or override models (same syntax as other providers), or configure in the web UI:
      # OPENAICOMPATIBLE_MODEL_LIST=+llama3=My Llama,+qwen2.5=Qwen 2.5
      # S3_ACCESS_KEY_ID=... (required for Picbed)
    ports:
      - '3210:3210'

  lobe-db:
    image: postgres:16
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: postgres
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d postgres']
      interval: 5s
      timeout: 5s
      retries: 5
```

Database migrations run automatically on container startup when **`DATABASE_URL`** is set (see `scripts/serverLauncher/startServer.js`). No manual setup required for a fresh deployment.

---

## Database Notes

- Migrations live in `packages/database/migrations/` and are baked into the Docker image
- Drizzle ORM tracks applied migrations via the `drizzle_migrations` table in PostgreSQL
- **Never use `bun run db:push` against production** — it bypasses migration tracking
- On a fresh empty DB, all migrations (0000 → latest) run automatically on first container start

### `assistant_memory` / `column ... does not exist` after upgrade

If the UI shows repeated **Request failed** errors and logs contain `column ... assistant_memory does not exist` (PostgreSQL `42703`), the database never received migration **`0043_add_agent_assistant_memory.sql`**.

**Fix (pick one):**

1. **Restart the app container** after pulling the new image so startup runs the migrator (requires `DATABASE_URL`; migrations run before the server binds).
2. **Apply the SQL manually** against your production database, then restart:

```sql
ALTER TABLE agents ADD COLUMN IF NOT EXISTS assistant_memory text;
```

If you use an external Postgres or a compose file that omitted migrations before, ensure `DATABASE_URL` points at that DB so the container migrator can record the migration in `drizzle_migrations`.

### Migration Troubleshooting

If your DB was bootstrapped outside the migration system (`drizzle_migrations` table missing but tables already exist), seed the tracking table so future migrations apply correctly:

```bash
docker exec -it lobe-db psql -U "
CREATE TABLE IF NOT EXISTS drizzle_migrations (
  id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
);
INSERT INTO drizzle_migrations (hash, created_at) VALUES
('0000_init',1),('0001_add_client_id',2),('0002_amusing_puma',3),
-- ... insert all tags through the latest migration
ON CONFLICT DO NOTHING;" < user > -d < db > -c
```

---

## Authentication Modes

LobeHub requires `DATABASE_URL` + `DATABASE_DRIVER` (PostgreSQL). Auth is **required** for Docker deployments — the container refuses to start without at least one of `NEXT_PUBLIC_ENABLE_NEXT_AUTH`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or `AUTH_TOKEN` set.

### 1. Credentials Login (browser — single-user, no OAuth needed)

A built-in username/password or token login page, powered by NextAuth's Credentials provider. No external OAuth service is required.

> [!IMPORTANT]
> This mode is env-backed, not DB-backed. The username/password or token is validated directly from environment variables and is **not** stored or managed in PostgreSQL.
>
> It is acceptable for testing, bootstrap access, or simple single-admin setups, but it is **not recommended** as the primary auth mode for formal production or multi-user deployments. For those cases, prefer OAuth / OIDC providers via NextAuth.

NextAuth browser sessions persist in a cookie. Use `AUTH_SESSION_MAX_AGE_DAYS` to control how long that login cookie remains valid. Default is `30` days.

**Option A — Username & Password:**

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials
AUTH_SESSION_MAX_AGE_DAYS=7
AUTH_CREDENTIALS_USERNAME=admin
AUTH_CREDENTIALS_PASSWORD=your-strong-password
AUTH_USER_ID=default_user           # optional — defaults to "credentials_user"
```

**Option B — Token only:**

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials
AUTH_SESSION_MAX_AGE_DAYS=7
AUTH_TOKEN=your-secret-token
AUTH_USER_ID=default_user           # optional — defaults to "credentials_user"
```

**Option C — Both methods enabled (users can pick either tab on the login page):**

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials
AUTH_SESSION_MAX_AGE_DAYS=7
AUTH_CREDENTIALS_USERNAME=admin
AUTH_CREDENTIALS_PASSWORD=your-strong-password
AUTH_TOKEN=your-secret-token
AUTH_USER_ID=default_user
```

Open the app in a browser → you'll see a credentials login page. The Password and Access Token tabs are both shown when the credentials provider is enabled, but each tab only works if its corresponding env vars are configured.

> [!NOTE]
> `AUTH_TOKEN` can also be used for machine-to-machine API access. Send `Authorization: Bearer <token>` in API requests. The same token works for both browser login and API calls.

> [!IMPORTANT]
> The credentials login form only appears when `NEXT_AUTH_SSO_PROVIDERS` explicitly includes `credentials`.
>
> If you set `AUTH_CREDENTIALS_USERNAME` / `AUTH_CREDENTIALS_PASSWORD` but leave `NEXT_AUTH_SSO_PROVIDERS=github`, the sign-in page will only show GitHub.

`AUTH_SESSION_MAX_AGE_DAYS` applies to NextAuth browser sessions, including credentials login and OAuth login. Examples:

- `AUTH_SESSION_MAX_AGE_DAYS=1` → expire after 1 day
- `AUTH_SESSION_MAX_AGE_DAYS=7` → expire after 7 days
- `AUTH_SESSION_MAX_AGE_DAYS=30` → default

See [doc/credentials-login-flow.md](doc/credentials-login-flow.md) for the detailed credentials login flow, post-login behavior, and Mermaid diagram.

### 2. Credentials + OAuth (combine both on one login page)

You can enable credentials alongside OAuth providers. The login page will show both the username/password form and the OAuth buttons:

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=credentials,github
AUTH_SESSION_MAX_AGE_DAYS=7
AUTH_CREDENTIALS_USERNAME=admin
AUTH_CREDENTIALS_PASSWORD=your-strong-password
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

This explicit `credentials,github` pattern is the intended configuration. Credentials login is not auto-added just because username/password env vars are present.

> [!TIP]
> Use `NEXT_AUTH_SSO_PROVIDERS=credentials,github` when you want both the credentials form and GitHub on the same sign-in page.

### 3. NextAuth / OAuth only (browser users — single or multi-user)

Configure an OAuth provider (Auth0, GitHub, Authentik, Zitadel, etc.) via NextAuth:

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=auth0        # or github, authentik, zitadel, ...
AUTH_SESSION_MAX_AGE_DAYS=7          # optional, default 30
# Provider-specific vars (example: Auth0)
AUTH_AUTH0_ID=...
AUTH_AUTH0_SECRET=...
AUTH_AUTH0_ISSUER=https://your-domain.auth0.com
```

---

## LLM provider environment variables

LobeHub’s **in-house documentation** focuses on the providers that match the **extended model bank** called out in this README (GPT / Claude / Gemini / Kimi / MiniMax), plus the two common self-hosted patterns: **OpenAI-compatible gateways** and **Ollama**. Wire keys on the `lobe-chat` service’s `environment:` list (or your process manager / `.env`).

For **every** provider name, flag, and optional URL that the codebase accepts—including Azure, Bedrock, OpenRouter, and dozens of others inherited from upstream—see [`src/envs/llm.ts`](src/envs/llm.ts). The subsections below are **not** an exhaustive list.

**Conventions**

- Typically, setting a provider’s `*_API_KEY` enables that integration.
- `ENABLED_OPENAI=0` disables the built-in OpenAI path even if `OPENAI_API_KEY` is present.
- `ENABLED_OLLAMA=0` hides Ollama from server-side discovery; the Ollama base URL is still set in the app UI when used.

### OpenAI (GPT series)

```env
OPENAI_API_KEY=sk-...
```

### Anthropic (Claude)

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Google (Gemini)

```env
GOOGLE_API_KEY=...
```

### Moonshot (Kimi K2.x and related)

```env
MOONSHOT_API_KEY=...
```

### MiniMax

```env
MINIMAX_API_KEY=...
# Optional custom HTTP endpoint:
# MINIMAX_PROXY_URL=https://...
```

### OpenAI-compatible (vLLM, LiteLLM, custom gateways)

Use any OpenAI-style HTTP API. Model list can also be configured in the web UI.

```env
OPENAICOMPATIBLE_API_KEY=your-key
OPENAICOMPATIBLE_PROXY_URL=https://your-host/v1
# OPENAICOMPATIBLE_MODEL_LIST=+llama3=My Llama,+qwen2.5=Qwen 2.5
```

### Ollama (local models)

No API key is required for a default local daemon. Disable discovery if you do not use Ollama on the server:

```env
# ENABLED_OLLAMA=0
```

### Other providers

Anything beyond the sections above uses the same pattern (`*_API_KEY`, optional proxy/base URL, and sometimes `ENABLED_*` flags). Refer to [`src/envs/llm.ts`](src/envs/llm.ts) for the complete, authoritative map—do not assume every upstream provider is curated or tested for LobeHub releases.

---

## Adding a Tool to Tools Hub

1. Create `src/app/[variants]/(main)/tools/<tool-name>/page.tsx`
2. Add i18n keys to `src/locales/default/tools.ts` + `locales/en-US/tools.json` + `locales/zh-CN/tools.json`
3. Add DB migration SQL in `packages/database/migrations/` + register in `meta/_journal.json`
4. Add tRPC router in `src/server/routers/lambda/` + register in `lambda/index.ts`
5. Add nav entry to `src/app/[variants]/(main)/tools/_layout/Desktop/Nav.tsx`

---

## Development

```bash
# Prerequisites: Node.js, pnpm, bun

# Install dependencies
pnpm install

# Start dev server (port 3010)
bun run dev

# Type check
bun run type-check

# Lint
bun run lint

# Database (requires DATABASE_URL env var)
bun run db:generate # generate migration SQL from schema changes
bun run db:migrate  # apply migrations locally
bun run db:studio   # open Drizzle Studio
```

---

## Docker Release

Releases are automated via GitHub Actions on version tags:

```bash
# 1. Verify all intended files are staged
git status

# 2. Bump version in package.json, then:
git add package.json && git commit -m "🔖 chore: bump version to vX.X.X"

# 3. Tag and push — GitHub Actions builds and pushes to Docker Hub
git tag vX.X.X && git push origin HEAD:main && git push origin vX.X.X
```

Builds and pushes `lqdflying/lobehub:X.X.X` and `lqdflying/lobehub:latest` to Docker Hub.

---

## License

Based on [LobeChat](https://github.com/lobehub/lobe-chat) — [Apache 2.0](./LICENSE).
