# Durable Conversation Generation

ChatHub runs topic/session generation on the server so closing a tab, losing
SSE, navigating elsewhere, or restarting a container does not cancel in-flight
work. Explicit Stop and destructive history actions such as retry, rewind,
delete, and clear cancel the matching work.

The GitHub Wiki clone (`wiki/`) was unavailable in the session that landed this
design, so user-facing workflow notes also live in the root README.

## Runtime flow

```
Browser → enqueue API → PostgreSQL (messages + operation + Graphile job)
PostgreSQL → Graphile Worker → ModelRuntime + tools
Worker → checkpoint messages/events
Browser → SSE/poll → reflect
```

Closing the event stream does **not** cancel the job. Stop calls
`conversationGeneration.cancel`, which sets `cancelRequestedAt`. The worker
polls that flag and finalizes the operation as `cancelled`.

## Why PostgreSQL, not Redis

ChatHub is Docker + PostgreSQL only. Graphile Worker stores jobs in the
`graphile_worker` schema, which Graphile owns and migrates via `run()` /
`utils.migrate()`. Drizzle does not manage that schema. Conversation state
lives in ChatHub tables so a replica or replacement container can resume
pending work.

Do not reuse `async_tasks` for chat generation. Those rows are a different
lifecycle (image/file jobs) and are not a conversation lane.

## Tables

Migrations `0054_add_conversation_generation.sql` through
`0056_harden_conversation_generation_indexes.sql`, plus
`scripts/migrateServerDB/ensureConversationGenerationOperations.cjs`:

- `conversation_generation_operations` — one row per lane job (`cgo` ids)
- `conversation_generation_steps` — idempotent tool/step records (`cgs` ids),
  unique by operation and deterministic tool-call input hash
- `conversation_generation_events` — append-only SSE payload (`bigserial` ids)

Lanes are unique only while status is `pending` or `processing`. A
`cancelling` predecessor therefore cannot block its replacement:

- session: `{userId}:session:{sessionId|inbox}:{topicId|none}:{threadId|main}`
- group: `{userId}:group:{groupId}:{topicId|none}:{threadId|main}`

Job payload is `{ operationId, userId }` only. Credentials are resolved from
encrypted user/provider vaults at execution time.

## Feature flag

`durable_conversation_generation` defaults **on** and maps to
`enableDurableConversationGeneration`.

Rollback:

```env
FEATURE_FLAGS=-durable_conversation_generation
```

Client code must read `window.global_serverConfigStore` only. Calling
`createServerConfigStore()` in the browser helper would default the flag on in
unit tests and change send-message payloads.

When the flag is on, `sendMessageInServer` persists the user message, creates
the assistant placeholder, and enqueues a Graphile job in the same write lock.
The response includes `operationId`. If `operationId` is absent, the existing
browser `internal_execAgentRuntime` path still runs.

`fetchOnClient` providers without a server-reachable API key fail enqueue with
`PRECONDITION_FAILED`. That is not a silent fallback to the browser runtime.

## Worker bootstrap

`src/instrumentation.ts` starts a periodic sweeper in the Node runtime regardless
of whether Graphile Worker boots successfully. The sweeper requeues pending
operations with a null `workerJobId`. A stale `processing` attempt is atomically
returned to `pending` and re-enqueued while retry budget remains, then finalized
as `failed` after the last attempt. Stale `cancelling` rows become `cancelled`.

Graphile Worker itself is started in a separate try/catch. A boot failure is
logged and does not crash Next.js. ChatHub owns signal handling because the
runner uses `noHandleSignals`: `SIGTERM`/`SIGINT` clear the sweeper and await
`Runner.stop()`. The Docker launcher forwards those signals to the Next.js child
and propagates its exit status.

Each worker attempt claims `pending → processing` with compare-and-set guards.
Retryable failures return the row to `pending` and are rethrown so Graphile
applies backoff. Heartbeats cover the whole operation, and checkpoint/final
writes require the same attempt and lane generation. A terminal row is never
rewritten by a late worker.

## Lane replacement

Each operation stores a monotonic `laneGeneration` token per conversation lane.
`replaceActive` requests cancellation on the prior operation and enqueues a new
one with a higher token. Workers checkpointing an older token stop without
writing further snapshots.

The active-lane unique index covers only `pending` and `processing`, so a
`cancelling` operation no longer blocks the replacement enqueue.

## Client sync

`useConversationGenerationSync` (ChatList `Content.tsx`) opens
`GET /webapi/conversation-generation/stream` with auth headers. Native
`EventSource` is not used because it cannot send those headers. The hook keeps a
per-user event cursor across topic switches. If SSE ends or fails, it polls
`conversationGeneration.listEvents`.

Events are applied only when the attached operation still matches the active
session/topic/thread, operation kind, lane generation, user scope, and
`conversationClearGeneration`. Navigation detaches local UI state without
cancelling server work. Explicit Stop, retry/rewind, delete, and clear perform
scoped server cancellation.

Stop still goes through `stopGenerateMessage` / group supervisor stop →
`cancelAndDetachDurableOps` → `conversationGeneration.cancel`. Durable
generating UI uses `internal_markDurableGenerating` so it does not install
`beforeunload`.

Useful env vars:

| Variable                          | Effect                             |
| --------------------------------- | ---------------------------------- |
| `CONVERSATION_WORKER_CONCURRENCY` | Graphile concurrency (default `4`) |
| `DISABLE_CONVERSATION_WORKER=1`   | Skip worker start (tests/build)    |

## Workflows on the engine

| Kind                               | Trigger                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `chat` / `continue` / `regenerate` | send, tool continuation, retry                                         |
| `group_supervisor`                 | provider-neutral structured decision, then guarded `group_agent` turns |
| `topic_title`                      | localized explicit rename for a new/untitled topic                     |
| `memory_compaction`                | planned background compaction (not pre-send)                           |
| `translation`                      | message translate                                                      |
| `tts`                              | metadata-only stub; browser TTS persist remains client-side            |
| `rag`                              | retrieval is injected into chat turns via `config.ragQuery`            |

Tool calls use `conversation_generation_steps` before side effects. A retry
replays the completed result for the same operation/tool-call identity instead
of invoking it again. Fixed-memory read/modify/write and step completion share
one transaction with a row lock. HTTP MCP results—including handled remote
errors—are persisted to the tool message and its recovery state.

The worker currently supports builtin web browsing, fixed Memory, activated
skills, and HTTP MCP. Image generation, code interpreter, non-HTTP MCP, and
unknown plugin runtimes are capability-gated before durable enqueue, so the
existing browser runtime handles the whole conversation rather than receiving a
fake server success. Pre-send compaction also stays on the client because it
must finish before the user message is committed.

Background compaction is different: the client runs the normal eligibility and
prefix planner, then stores a non-secret plan snapshot with candidate message
IDs, prior summary/cursor, fingerprint, watermarks, and expected conversation
version. The worker batches that exact prefix and atomically verifies/persists
the summary, cursor, archives, and bounded debug log. An edit, delete, clear, or
other invalidation makes the operation `interrupted` instead of committing a
stale summary.

The tool continuation budget is checked before creating another assistant
placeholder. A nested group-agent turn returns an explicit outcome; failed,
cancelled, or interrupted children cannot be overwritten by supervisor success.

## Startup schema repair

`ensureConversationGenerationOperations.cjs` runs after Drizzle migrations on
container startup. It inspects the active-lane index predicate and replaces the
legacy 0054 definition if it still includes `cancelling`. It also deduplicates
legacy step hashes (preferring succeeded/latest rows) before adding the unique
tool-step replay index. `CREATE INDEX IF NOT EXISTS` alone is deliberately not
used as a definition check.

## Tests and operations

High-signal suites:

- `src/config/featureFlags/schema.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/generateAIChatV2.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/conversationGeneration.test.ts`
- `src/server/services/conversationGeneration/*.test.ts`
- `scripts/migrateServerDB/ensureConversationGenerationOperations.test.ts`
- `packages/types/src/conversationGeneration.test.ts`

Model tests that top-level-await `getTestDB()` are not required for this
feature unless `DATABASE_TEST_URL` is present.

## Key source references

- `packages/database/src/schemas/conversationGeneration.ts`
- `packages/database/src/models/conversationGeneration.ts`
- `src/server/services/conversationGeneration/`
- `src/server/routers/lambda/conversationGeneration.ts`
- `src/app/(backend)/webapi/conversation-generation/stream/route.ts`
- `src/store/chat/slices/aiChat/actions/conversationGeneration.ts`
- `src/helpers/durableConversationGeneration.ts`
