# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Naming Conventions (Critical)

When modifying existing resources, **ALWAYS match existing variable/function naming patterns**. Check for conventions before creating new names:

- AI provider variables: `minimax_*`, `kimi_*`, `openai_*` — match the provider's config file pattern
- Databricks/SPN credentials: `databricks_spn_client_id`, `databricks_spn_client_secret`, `databricks_spn_tenant_id`, `databricks_dev_spn_object_id`
- Database/ORM: use `camelCase` for DB columns (Drizzle convention)
- React components: `PascalCase.tsx`
- Hooks: `use*.ts`
- Test files: `__tests__/` directories or `.test.ts` suffix

## Git Workflow

- **Before merge**: show `git status` and `git branch -a`
- **After merge / push**: always run `git fetch --prune` before assuming branch cleanup is complete — this verifies remote branch was actually deleted
- **After merge**: verify with `git log --oneline -3`
- **For stash**: run `git stash list` before push/pop
- Commit messages must be prefixed with a gitmoji

## Windows Password Complexity

When generating passwords or configuring Windows/Ansible systems:
- Ensure passwords meet Windows complexity: **3 of 4 categories** (uppercase, lowercase, numbers, special characters)
- Avoid shell escaping issues with special characters — use a proven password generator
- This rule applies to all Ansible playbooks, Terraform Windows configs, and any automated password generation

## Project Overview

**LobeHub** is a custom fork/distribution of LobeChat, maintained independently starting at v3.0.0. It targets self-hosted Docker + PostgreSQL deployments only. Docker image: `docker.io/lqdflying/lobehub`.

Upstream reference: https://github.com/lobehub/lobe-chat (diverged significantly — do not blindly sync upstream changes).

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript — hybrid Next.js app router + SPA via `react-router-dom`
- **UI**: `@lobehub/ui`, Ant Design, `antd-style` (CSS-in-JS via `createStyles`)
- **State**: Zustand stores + SWR for server data fetching
- **Backend**: tRPC (type-safe API), Next.js API routes
- **Database**: PostgreSQL only (server mode), Drizzle ORM
- **Testing**: Vitest + Testing Library (unit), Playwright + Cucumber (e2e)
- **Monorepo**: pnpm workspaces; `bun` to run scripts, `bunx` for executables

## Commands

```bash
# Development
bun run dev                  # Start dev server on :3010
bun run dev:desktop          # Desktop (Electron) renderer on :3015

# Build
bun run build                # Production build
bun run build:docker         # Docker build

# Testing — NEVER run `bun run test` (runs all tests, ~10 min)
bunx vitest run --silent='passed-only' '[file-path]'
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# Type checking
bun run type-check            # Uses tsgo (fast)
bun run type-check:tsc        # Uses tsc (strict)

# Linting
bun run lint                  # ts + style + type-check + circular deps
bun run lint:ts               # ESLint only
bun run lint:style            # Stylelint only

# Database
bun run db:generate           # Generate Drizzle migrations
bun run db:migrate            # Run migrations
bun run db:studio             # Open Drizzle Studio
# NEVER use db:push against production — it bypasses migration tracking
```

## Project Structure

```
src/
├── app/                  # Next.js App Router
│   ├── (backend)/        # Server-only routes (API, tRPC endpoints)
│   └── [variants]/       # Client SPA entry points
│       └── (main)/
│           ├── tools/    # Tools Hub (Picbed, future tools)
│           └── ...       # chat, discover, image, settings, etc.
├── features/             # Large self-contained UI feature areas
│   └── Conversation/     # Core chat UI
├── store/                # Zustand stores (one per domain)
├── services/             # Client-side service layer (calls tRPC/API)
├── server/
│   ├── routers/          # tRPC routers
│   │   ├── lambda/       # Synchronous routes
│   │   ├── async/        # Async/streaming routes
│   │   └── tools/        # Tool call routes
│   └── services/         # Server-side service implementations
├── locales/default/      # i18n source of truth (TypeScript)
└── libs/                 # Shared utilities and abstractions

packages/
├── database/             # Drizzle schemas, models, repositories (@lobechat/database)
│   └── migrations/       # SQL migration files (manually written for new tables)
├── agent-runtime/        # LLM provider adapters
├── model-bank/           # Model definitions and capabilities
└── ...
```

## Architecture Patterns

### Store Structure
Every Zustand store follows a consistent layout:
```
store/<domain>/
├── store.ts          # createWithEqualityFn, merges slices
├── initialState.ts   # Full state type + default values
├── selectors.ts      # Derived state selectors
└── slices/           # Action groups (each slice = one concern)
```
Prefer `vi.spyOn` over `vi.mock` when testing stores.

### Data Flow
`Component → useChatStore action → service (src/services/) → tRPC router → server service → DB`

### tRPC Router Locations
- `src/server/routers/lambda/` — standard request/response
- `src/server/routers/async/` — long-running / queued operations
- `src/server/routers/tools/` — agent tool calls

### Path Alias
`@/` resolves to `src/`. In tests, also: `@/database` → `packages/database/src`.

### CSS-in-JS
Use `createStyles` from `antd-style`. Avoid inline styles or plain CSS modules.

## Tools Hub

Tools is a major left sidebar entry (Wrench icon, `SidebarTabKey.Tools`, always visible).
All utility features live under `/tools/*` with a shared left sub-navigation panel.

### Current Tools
| Tool | Route | DB Table |
|------|-------|----------|
| Picbed (image hosting) | `/tools/picbed` | `picbed_images` |

### Key Files
- Sidebar nav entry: `src/app/[variants]/(main)/_layout/Desktop/SideBar/TopActions.tsx`
- Tools sub-nav: `src/app/[variants]/(main)/tools/_layout/Desktop/Nav.tsx`
- Shared layout: `src/app/[variants]/(main)/tools/_layout/Desktop/`
- i18n namespace: `src/locales/default/tools.ts` + `locales/en-US/tools.json` + `locales/zh-CN/tools.json`

### Adding a New Tool
1. Create `src/app/[variants]/(main)/tools/[tool-name]/page.tsx`
2. Add i18n keys to `src/locales/default/tools.ts` + both locale JSONs
3. Add DB migration SQL + register in `packages/database/migrations/meta/_journal.json`
4. Add tRPC router in `src/server/routers/lambda/` + register in `lambda/index.ts`
5. Add nav entry in `Nav.tsx`
6. Add route to middleware matcher in `src/middleware.ts`

## Database & Migrations

- Migration files: `packages/database/migrations/*.sql`
- Journal: `packages/database/migrations/meta/_journal.json` — must be updated manually when adding migrations
- Next migration index: check journal for the highest `idx` and increment by 1
- Migrations run automatically at container startup via `scripts/serverLauncher/startServer.js` → `docker.cjs`
- Migration runs only if `DATABASE_DRIVER` env var is set
- `drizzle_migrations` table in PostgreSQL tracks applied migrations
- **Never use `db:push` against production** — bypasses tracking

## Git & Release Workflow

- Commit messages must be prefixed with a gitmoji
- Version scheme: `v3.x.x` (LobeHub independent versioning, not upstream v1.x)
- Release flow:
  ```bash
  sed -i 's/"version": "old"/"version": "new"/' package.json
  git add package.json && git commit -m "🔖 chore: bump version to vX.X.X"
  git tag vX.X.X && git push origin HEAD:main && git push origin vX.X.X
  ```
- GitHub Actions (`.github/workflows/docker-release.yml`) triggers on `v*.*.*` tags
- Pushes `lqdflying/lobehub:X.X.X` and `lqdflying/lobehub:latest` to Docker Hub

## i18n

- Add new keys to `src/locales/default/<namespace>.ts` (TypeScript source of truth)
- Also add to `locales/zh-CN/<namespace>.json` and `locales/en-US/<namespace>.json` manually
- **Never run `pnpm i18n`** — CI handles all other locales automatically
- New namespace requires creating both JSON files (e.g. `tools.json` — do not forget this)

## Testing Notes

- Wrap file paths in single quotes: `'src/store/chat/**'`
- After 2 failed fix attempts on a test, stop and ask for help
- Run `bun run type-check` after code changes — tests must also pass type checking
