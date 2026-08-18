# Durable Conversation Generation

ChatHub runs topic/session generation on the server so closing a tab, losing
SSE, navigating elsewhere, or restarting a container does not cancel in-flight
work. Explicit Stop and destructive history actions such as retry, rewind,
delete, and clear cancel the matching work.

User-facing workflow notes live in the GitHub Wiki:
[Background Conversation Generation](https://github.com/lqdflying/chathub/wiki/Background-Conversation-Generation).

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
`0057_conversation_generation_placeholder_cleanup.sql`, plus
`scripts/migrateServerDB/ensureConversationGenerationOperations.cjs`:

- `conversation_generation_operations` — one row per lane job (`cgo` ids)
- `conversation_generation_steps` — idempotent tool/step records (`cgs` ids),
  unique by operation and deterministic tool-call input hash
- `conversation_generation_events` — append-only SSE payload (`bigserial` ids)

Lanes are unique only while status is `pending` or `processing`. A
`cancelling` predecessor therefore cannot block its replacement:

- session: `{userId}:session:{sessionId|inbox}:{topicId|none}:{threadId|main}:{family}`
- group chat/continue/regenerate: `{userId}:group:{groupId}:{topicId|none}:{threadId|main}:{family}`
- group supervisor: `{...}:{family}:supervisor`
- group agent: `{...}:{family}:agent:{agentId}:{targetId|default}`

`family` groups Stop scope: `chat` covers `chat` / `continue` / `regenerate` /
`group_supervisor` / `group_agent`. Title, translation, compaction, TTS, and RAG
each have their own family so they cannot cancel an in-flight reply. Supervisor
and member work stay in the chat family for Stop, but they no longer share a
replacement lane: parallel group members must not cancel one another.

Enqueue callers pass a **request-scoped** `idempotencyKey`. Chat send/continue
and group-member turns can use the unique message id for that send. Supervisor,
regenerate, translation, and title each mint a fresh request id at the action
boundary and reuse it only for that enqueue plus a lost-response lookup. A
typed `CONFLICT` (lane busy, or the key was used for a different request) is
not recovered by key lookup — recovering a terminal operation would skip the
new user action.

A retry inspects the owned assistant before calling the model: tool-bearing
rows resume tool execution, rows with an explicit
`conversationGenerationTurnComplete` metadata marker skip a new model call,
and an unmarked partial checkpoint is regenerated (never treated as a finished
answer). The owned assistant is never sent back as history. Standalone portal
threads send only the source message plus that thread’s children.

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

`fetchOnClient` providers without a server-reachable API key, unsupported
browser-only tools (`UNPROCESSABLE_CONTENT`), and a disabled flag all drop
durable enqueue. The user message is still saved and the connected-tab runtime
runs. `tryEnqueue` recovers a lane only by `idempotencyKey` after a transport
failure, and never after a typed `CONFLICT`, credential miss, or capability
miss. It must not attach a previous chat job as if it were the new request.

Context Export arms a one-shot browser capture. While that capture is armed,
the send skips durable enqueue so the existing preview still records the
request.

The worker filters history the same way the UI does: main-topic messages have
no `threadId`; a continuation portal thread uses the source-message prefix plus
that thread; a standalone portal thread uses only the source message plus that
thread. Compaction still refuses `threadId`.

Stop awaits cancel, detaches only the collected operation ids, and defaults to
chat-family kinds so title/translate/compaction keep running. `finalizeActive`
does not rewrite `cancelling` to `succeeded` or `failed`.

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
Retryable failures return the row to `pending`, clear `workerJobId` so the
sweeper can re-enqueue if Graphile does not retry, and are rethrown so Graphile
applies backoff. Heartbeats cover the whole operation: a missed heartbeat
(no matching `processing` row/attempt) aborts the local run and feeds
`shouldStopGeneration`. Checkpoint/final writes require the same attempt and
lane generation. A terminal row is never rewritten by a late worker.

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
per-user event cursor across topic switches. A `reset` event (cursor ahead of
the retained stream) replays from cursor `0` and resyncs active operations. If
SSE ends or fails, the hook polls `conversationGeneration.listEvents` while it
reconnects the stream with backoff instead of staying on poll-only.

Events are applied only when the attached operation still matches the visible
session/topic/thread (`portalThreadId` when a thread portal is open, otherwise
`activeThreadId`) and `conversationClearGeneration`. Title and translation use
separate lanes, so their events can attach alongside chat. Navigation detaches
local UI state without cancelling server work. Explicit Stop, retry/rewind,
delete, and clear perform scoped server cancellation.

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
placeholder. Creating that placeholder and recording its id happen in one
database transaction (Drizzle nested transactions use PostgreSQL savepoints).
Supervisor child ids are appended with a single JSONB `UPDATE`
(`jsonb_exists` / `jsonb_set` / `jsonb_build_array`) so PostgreSQL’s row lock
and READ COMMITTED re-evaluation keep parallel member continuations from
dropping a committed sibling. A retry that finds a persisted assistant id with
no row recreates the loading placeholder and refuses to finalize success if the
row is still missing. A nested group-agent turn returns an explicit outcome;
failed, cancelled, or interrupted children cannot be overwritten by supervisor
success. Stop, pending cancel, stale finalization, and a failed round clear
leftover loading placeholders in the same transaction as the terminal status
change, then set `placeholdersCleanedAt`. A sweeper keyset-pages unmarked
terminal rows (`finished_at`, `id`, partial index) until none remain so a crash
between those writes cannot leave permanent `LOADING_FLAT` rows. Successful
sibling replies keep their content and are not annotated with another member’s
error; round-level failure lives on the operation. After a tool continuation,
cancel, clear, and failure annotate or clear the newest assistant, not the
completed tool-call row. Parallel member turns settle before the parent is
finalized.

## Startup schema repair

`ensureConversationGenerationOperations.cjs` runs after Drizzle migrations on
container startup. It inspects the active-lane index predicate and replaces the
legacy 0054 definition if it still includes `cancelling`. It also deduplicates
legacy step hashes (preferring succeeded/latest rows) before adding the unique
tool-step replay index, and adds `placeholders_cleaned_at` plus the partial
cleanup index for unmarked terminal jobs. `CREATE INDEX IF NOT EXISTS` alone is
deliberately not used as a definition check.

## Tests and operations

High-signal suites:

- `src/config/featureFlags/schema.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/generateAIChatV2.test.ts`
- `src/store/chat/slices/aiChat/actions/__tests__/conversationGeneration.test.ts`
- `src/server/services/conversationGeneration/*.test.ts`
- `src/services/__tests__/conversationGenerationEnqueue.test.ts`
- `scripts/migrateServerDB/ensureConversationGenerationOperations.test.ts`
- `src/hooks/useConversationGenerationSync.test.tsx`
- `packages/database/src/models/__tests__/conversationGeneration.cas.test.ts`

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
