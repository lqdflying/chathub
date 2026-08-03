# GitHub Copilot Instructions

## Working Philosophy: First Principles

Reason from raw requirements and root causes, not from convention or templates.

1. **Challenge unclear goals** — Do not assume I know what I want. If my motivation or objective is vague, stop and discuss before proceeding.
2. **Shortest path** — If the goal is clear but my proposed approach is suboptimal, say so directly and suggest a better one.
3. **Root-cause, not patches** — When a problem appears, trace it to its origin. Every decision must answer "why."
4. **Signal only** — Output the essentials. Cut anything that does not change a decision.

## Project Overview

**ChatHub** is a custom fork of LobeChat (diverged at v3.0.0), targeting self-hosted Docker + PostgreSQL deployments. Docker image: `docker.io/lqdflying/chathub`. Do **not** blindly sync upstream changes from `github.com/lobehub/lobe-chat`.

## Commands

```bash
# Dev server
bun run dev                   # :3010

# Build
bun run build                 # Production
bun run build:docker          # Docker build

# Test — NEVER run `bun run test` (runs all tests, ~10 min)
bunx vitest run --silent='passed-only' '[file-path]'        # single file/glob
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# Type check
bun run type-check             # tsgo (fast)
bun run type-check:tsc         # tsc (strict)

# Lint
bun run lint:ts                # ESLint only
bun run lint:style             # Stylelint only
bun run lint                   # ts + style + type-check + circular deps

# Database
bun run db:generate            # Generate Drizzle migrations
bun run db:migrate             # Run migrations
bun run db:studio              # Drizzle Studio UI
# NEVER use db:push against production — it bypasses migration tracking
```

**Wrap test file paths in single quotes.** Run `bun run type-check` after code changes.

## Architecture

### Tech Stack
- **Frontend**: Next.js 15, React 19, TypeScript — hybrid App Router + SPA via `react-router-dom`
- **UI**: `@lobehub/ui`, Ant Design, `antd-style` CSS-in-JS
- **State**: Zustand stores + SWR
- **Backend**: tRPC + Next.js API routes
- **Database**: PostgreSQL only, Drizzle ORM
- **Monorepo**: pnpm workspaces; use `bun` to run scripts, `bunx` for executables

### Data Flow
```
Component → useChatStore action → src/services/ → tRPC router → src/server/services/ → DB
```

### Auth Notes
- NextAuth credentials login is env-backed, not DB-backed: `AUTH_CREDENTIALS_USERNAME`, `AUTH_CREDENTIALS_PASSWORD`, and `AUTH_TOKEN` are validated directly from environment variables.
- Credentials/token values are not persisted to PostgreSQL. Only the authenticated user row/session state is created or updated as needed.
- To show the credentials form on the NextAuth sign-in page, `NEXT_AUTH_SSO_PROVIDERS` must explicitly include `credentials` such as `credentials,github`. Do not assume credentials auth is auto-enabled by the presence of env vars alone.
- `AUTH_SESSION_MAX_AGE_DAYS` controls NextAuth browser session lifetime in days. Default is `30` when unset.
- Env-backed username/password or token login is acceptable for testing, bootstrap, or simple single-admin use, but it is not the recommended approach for formal production or multi-user deployments.

### Key Source Directories
```
src/
├── app/
│   ├── (backend)/          # Server-only routes, API, tRPC endpoints
│   └── [variants]/(main)/  # Client SPA routes (chat, tools, settings, etc.)
├── features/               # Large self-contained UI areas (e.g. Conversation/)
├── store/                  # Zustand stores, one per domain
├── services/               # Client-side service layer
├── server/routers/
│   ├── lambda/             # Standard request/response tRPC routes
│   ├── async/              # Long-running/queued tRPC routes
│   └── tools/              # Agent tool call routes
├── server/services/        # Server-side service implementations
└── locales/default/        # i18n source of truth (TypeScript)

packages/
├── database/               # Drizzle schemas, models, repos (@lobechat/database)
│   └── migrations/         # SQL migration files
├── agent-runtime/          # LLM provider adapters
└── model-bank/             # Model definitions and capabilities
```

### Zustand Store Layout
Every store under `src/store/<domain>/` follows this structure:
```
store.ts          # createWithEqualityFn, merges slices
initialState.ts   # Full state type + default values
selectors.ts      # Derived state selectors
slices/           # Action groups (each slice = one concern)
```
Use `vi.spyOn` over `vi.mock` when testing stores.

### Path Aliases
- `@/` → `src/`
- In tests: `@/database` → `packages/database/src`, `@/const` → `packages/const/src`, `@/utils` → `packages/utils/src`

## Naming Conventions

- AI provider variables: `minimax_*`, `kimi_*`, `openai_*` — match the provider's config file pattern
- DB columns: `camelCase` (Drizzle convention)
- React components: `PascalCase.tsx`
- Hooks: `use*.ts`
- Test files: `__tests__/` directories or `.test.ts` suffix

## CSS-in-JS

Use `createStyles` from `antd-style`. Do not use inline styles or plain CSS modules.

## Database Migrations

- Migration SQL lives in `packages/database/migrations/*.sql`
- **Journal must be updated manually**: `packages/database/migrations/meta/_journal.json`
- New migration `idx` = highest existing `idx` + 1
- Migrations run automatically at container startup when `DATABASE_URL` is set

## i18n

- Add new keys to `src/locales/default/<namespace>.ts` (TypeScript source of truth)
- Also add to `locales/zh-CN/<namespace>.json` and `locales/en-US/<namespace>.json`
- New namespace: create both JSON files — don't forget them
- **Never run `pnpm i18n`** — CI handles other locales automatically

## Tools Hub

All utility features live under `/tools/*` with a shared left sub-nav panel (`SidebarTabKey.Tools`).

**Adding a new tool:**
1. Create `src/app/[variants]/(main)/tools/[tool-name]/page.tsx`
2. Add i18n keys to `src/locales/default/tools.ts` + both locale JSONs
3. Add migration SQL + register in `packages/database/migrations/meta/_journal.json`
4. Add tRPC router in `src/server/routers/lambda/` + register in `lambda/index.ts`
5. Add nav entry in `src/app/[variants]/(main)/tools/_layout/Desktop/Nav.tsx`
6. Add route to matcher in `src/middleware.ts`

## Git & Releases

- Commit messages must be prefixed with a gitmoji (e.g. `✨ feat:`, `🐛 fix:`, `🔖 chore:`)
- Version scheme: `v1.x.x` (ChatHub independent versioning)
- Release: bump `package.json`, commit, tag `vX.X.X`, push tag → GitHub Actions builds & pushes Docker image
