# Architecture Overview

ChatHub is structured as a Next.js application plus a set of workspace packages that concentrate provider logic, context shaping, model metadata, and utility behavior. The repo intentionally separates runtime concerns from UI concerns so provider behavior can be reused across the app, server modules, and tests.

## Main layers

### App layer (`src/`)

The `src/` tree contains the user-facing app, server modules, services, stores, and UI features. High-signal areas include:

- `src/server/modules/ModelRuntime/index.ts` — resolves per-provider credentials and initializes the runtime
- `src/services/chat/contextEngineering.ts` — builds the final message list that gets sent to the provider
- `src/services/mcp.ts` — discovers and invokes MCP tools
- `src/envs/llm.ts` — provider environment configuration schema

### Shared packages (`packages/`)

The monorepo packages hold reusable logic. The main ones for understanding chat behavior are:

- `packages/model-runtime` — provider adapters, OpenAI-compatible streaming, and model/runtime abstractions
- `packages/context-engine` — processor pipeline for message rewriting, tool handling, and placeholder resolution
- `packages/types` — shared chat/provider data contracts
- `packages/const` — app-wide flags and constants
- `packages/utils` — shared helpers used by both app and runtime code

## Product boundaries

The root README frames ChatHub as a self-hosted alternative to upstream LobeChat with the following product priorities:

- production-friendly Docker deployment
- PostgreSQL as the durable backing store
- built-in authentication
- a larger supported model/provider matrix
- extended tools and memory behavior for long conversations

These priorities explain why the codebase has both UI features and a substantial server/runtime surface.

## Account-owned chat-group membership

A row in `chat_groups_agents` is valid only when its `userId` matches both the
referenced `chat_groups.userId` and `agents.userId`. The database enforces this
with composite parent keys on `(id, userId)` and composite foreign keys from the
junction table. `ChatGroupModel` repeats the invariant at the authorization
boundary: membership reads join through an owned group, owned junction row, and
owned agent, while writes validate every referenced agent and group in one
transaction. Mixed-owner or missing identifier sets fail atomically rather than
being partially inserted or silently filtered.

Template-based group creation also captures canonical account scope plus the
session and chat-group store generations before creating members. It checks all
three values around every asynchronous boundary and never submits a partially
accumulated member list after invalidation. These client checks limit stale
work, but the model and PostgreSQL constraints remain authoritative.

## Change guidance

When making architectural changes, check whether they need to flow through all of these layers:

1. environment/schema changes in `src/envs/llm.ts`
2. server runtime initialization in `src/server/modules/ModelRuntime/index.ts`
3. provider adapter changes in `packages/model-runtime`
4. context shaping changes in `src/services/chat/contextEngineering.ts` and `packages/context-engine`
5. UI or settings surface changes in `src/app/[variants]/(main)/settings/provider/`

## Key source references

- `README.md`
- `package.json`
- `src/server/modules/ModelRuntime/index.ts`
- `src/services/chat/contextEngineering.ts`
- `src/services/mcp.ts`
- `packages/model-runtime/package.json`
