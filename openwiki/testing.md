# Testing and Change Checklist

ChatHub relies on package-level Vitest suites, app-level tests, and broader repo checks that include linting and type checking. The exact commands are defined in the root `package.json`.

## Common checks

The root scripts indicate the main verification commands are:

- `bun run type-check`
- `bun run lint`
- targeted Vitest runs, for example `bunx vitest run --silent='passed-only' '<file-or-pattern>'`
- `bun run test-app`
- `bun run test-server`
- `bun run db:generate`
- `bun run db:migrate`

Do not run the full `bun run test` suite by default; it is broad and slow. Prefer targeted tests for the package or feature area you changed.

## Where tests live

High-signal tests are colocated with the runtime and service code. For example:

- `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.test.ts`
- `packages/model-runtime/src/providers/openai/index.test.ts`
- `packages/context-engine/src/processors/__tests__/PlaceholderVariables.test.ts`
- `src/services/chat/contextEngineering.test.ts`
- `src/server/sitemap.test.ts`

## What to verify when changing major areas

### Provider/runtime changes

Run the model-runtime tests and inspect stream fixtures. Provider changes often affect cache behavior, error normalization, and message conversion.

For OpenAI-compatible streaming changes, include `packages/model-runtime/src/utils/response.test.ts`, `packages/model-runtime/src/core/streams/protocol.test.ts`, and `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`. Keepalive coverage should verify the immediate comment, idle heartbeat, complete-frame boundaries, pending-handshake cancellation, and typed first-chunk errors. Also run `packages/fetch-sse/src/__tests__/fetchSSE.test.ts` and `packages/utils/src/client/fetchEventSource/parse.test.ts` when changing SSE comments or parsing.

### Context-engine changes

Run the context-engine tests and the chat context engineering test. Pipeline ordering issues usually show up here first.

### MCP/tool changes

Check service tests and any UI tests around provider/tool configuration. The `src/services/mcp.ts` path can also affect desktop behavior.

For concurrent MCP result handling, cover the Tools tRPC client, server router persistence, optimistic chat-store behavior, and per-message abort controllers. A high-signal regression uses concurrent Tavily-shaped `search`, `extract`, and `map` calls and asserts that each serialized result is written to its matching tool-message ID without a second browser `message.update` in server mode.

### Auth/env changes

Validate the README, `doc/credentials-login-flow.md`, and any env-schema changes together. Configuration drift is common in this area.

## Change checklist for future agents

Before finishing a change, verify:

1. the relevant package/service tests still pass
2. the root type-check and lint scripts still pass, or the failure is understood
3. public docs mention any new env var or workflow change
4. any UI setting changes match the backend/runtime resolution logic

## Key source references

- `package.json`
- `packages/model-runtime/src/**`
- `packages/context-engine/src/**`
- `src/services/**`
- `src/server/**`
