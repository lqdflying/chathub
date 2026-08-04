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

Check service tests and any UI tests around provider/tool configuration.

MCP runtime coverage is HTTP-only. Verify URL/auth parsing, the server MCP
client and router, OAuth refresh, tool-result persistence, and rejection of
legacy stdio connection records. Do not add desktop IPC, subprocess, or local
MCP transport fixtures except when asserting that an old record is rejected or
can be removed.

For concurrent MCP result handling, cover the Tools tRPC client, server router persistence, optimistic chat-store behavior, and per-message abort controllers. A high-signal regression uses concurrent Tavily-shaped `search`, `extract`, and `map` calls and asserts that each serialized result is written to its matching tool-message ID without a second browser `message.update` in server mode.

### Auth/env changes

Validate the README, `doc/credentials-login-flow.md`, and any env-schema changes together. Configuration drift is common in this area.

### Knowledge Base and RAG changes

Cover the positive chunkability boundary, loader MIME/extension routing, the
provider adapter request and vector-shape contract, file upload filtering, and
chat retrieval behavior. High-signal suites include:

- `packages/utils/src/isChunkableFile.test.ts`
- `src/libs/langchain/loaders/index.test.ts`
- `src/server/services/rag/embedding.test.ts`
- `src/store/file/slices/fileManager/action.test.ts`
- `src/store/file/slices/chat/action.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/rag.test.ts`

Database-model semantic-search tests require `DATABASE_TEST_URL` and a
PostgreSQL instance with pgvector. Verify that nearest-neighbor SQL orders by
the raw cosine-distance operator in ascending order; wrapping that expression
in a derived similarity sort can prevent HNSW index use.

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
