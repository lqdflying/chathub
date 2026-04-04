# LobeHub

> A self-hosted, production-ready AI chat platform — customized and extended from [LobeChat](https://github.com/lobehub/lobe-chat).

LobeHub is a private distribution of LobeChat tailored for self-hosted server deployments. It ships as a single Docker image with PostgreSQL, includes curated model definitions, and adds utility tooling not found in upstream.

---

## What's Different from Upstream LobeChat

| Area              | Upstream LobeChat         | LobeHub                                            |
| ----------------- | ------------------------- | -------------------------------------------------- |
| Deployment target | Vercel / Docker / Desktop | Docker + PostgreSQL only                           |
| Versioning        | v1.x                      | v3.x (independent)                                 |
| Model bank        | Upstream releases         | Extended: Claude 4.x, GPT-5.x, Gemini 3.x, Kimi K2.x, MiniMax |
| Tools Hub         | Not present               | Built-in (Picbed, API Tester + extensible sidebar) |
| Picbed            | Not present               | Image hosting with S3, auto URL copy               |
| API Tester        | Not present               | Browser-based REST API client at `/tools/apitest`  |
| Changelog page    | Enabled                   | Disabled (skips external fetch at build time)      |

---

## Features

### Core (inherited from LobeChat)

- Multi-model chat — OpenAI, Anthropic, Google, Moonshot/Kimi, MiniMax, Ollama, and 40+ providers
- Knowledge base with RAG (file upload, chunking, vector search)
- MCP plugin system with one-click installation
- Multi-user management with NextAuth / OIDC / Clerk
- AI image generation (DALL-E, GPT-Image, Gemini Image)
- Chain-of-thought, branching conversations, artifacts support
- TTS / STT voice conversation
- Real-time search integration

### LobeHub Additions

- **Tools Hub** — a dedicated left-sidebar section (Wrench icon) for utility tools, with its own sub-navigation panel
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
      # LLM API keys:
      # OPENAI_API_KEY=...
      # ANTHROPIC_API_KEY=...
      # MOONSHOT_API_KEY=... (for Kimi K2.x models)
      # MINIMAX_API_KEY=...
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

Database migrations run automatically on container startup. No manual setup required for a fresh deployment.

---

## Database Notes

- Migrations live in `packages/database/migrations/` and are baked into the Docker image
- Drizzle ORM tracks applied migrations via the `drizzle_migrations` table in PostgreSQL
- **Never use `bun run db:push` against production** — it bypasses migration tracking
- On a fresh empty DB, all migrations (0000 → latest) run automatically on first container start

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

LobeHub supports three authentication modes. Only one should be active at a time.

### 1. No Auth (default)

No environment variables needed. Anyone who can reach the URL can use the app. Suitable for local-only deployments.

Optionally restrict LLM API access with a shared passcode:

```env
ACCESS_CODE=your-passcode
```

> **⚠️ DB mode caveat:** `ACCESS_CODE` is a passcode for LLM API calls only — it does **not** protect the UI from being accessed, and it does **not** create separate users. In database mode, everyone who enters the correct code shares the **same single user's data** (chat history, files, settings). If you want real access control for a self-hosted instance, use **NextAuth** (mode 3) with a lightweight OAuth provider (GitHub, Authentik, etc.).

### 2. Token Auth (API / machine-to-machine only)

A static Bearer token for protecting API endpoints from automated/programmatic clients (scripts, CI, reverse proxies). All requests map to a single user ID stored in PostgreSQL.

```env
AUTH_TOKEN=your-secret-token        # required — callers must send this
AUTH_USER_ID=default_user           # optional — defaults to "default_user"
```

The caller must send the token on every API request:
```
Authorization: Bearer your-secret-token
```

> **Note:** This mode is designed for machine-to-machine API access. It does **not** provide a browser login page. For browser-based single-user access, use NextAuth (mode 3) with a simple OAuth provider like GitHub or Authentik.

Protected routes return `401 Unauthorized` if the token is missing or wrong. Public API routes (`/trpc`, `/webapi`, etc.) are always reachable.

### 3. NextAuth / OAuth (browser users — single or multi-user)

Configure an OAuth provider (Auth0, GitHub, Authentik, Zitadel, etc.) via NextAuth:

```env
NEXT_PUBLIC_ENABLE_NEXT_AUTH=1
NEXT_AUTH_SECRET=<your-secret>
NEXT_AUTH_SSO_PROVIDERS=auth0        # or github, authentik, zitadel, ...
# Provider-specific vars (example: Auth0)
AUTH_AUTH0_ID=...
AUTH_AUTH0_SECRET=...
AUTH_AUTH0_ISSUER=https://your-domain.auth0.com
```

---



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
