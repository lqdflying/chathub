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
the encrypted user vault plus env at execute time. MiniMax context trimming in
that worker uses model-bank window sizes (or an explicit override). It must not
import the client AI-infra Zustand store: that graph uses React hooks, and
Next.js fails `next build` when a server entry such as `instrumentation` pulls
it in
([react-client-hook-in-server-component](https://nextjs.org/docs/messages/react-client-hook-in-server-component)).

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
Unmarked terminal leftovers are claimed with `SELECT … FOR UPDATE SKIP LOCKED`
inside the cleanup transaction so overlapping replicas skip in-flight rows.
Each leftover’s cleanup and marker write run in a nested transaction (Drizzle
`tx.transaction(...)`, which issues `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`). A
failed leftover is left unmarked and logged; the outer page transaction stays
usable so later rows in that page can still commit. The keyset still advances
so later pages are not starved. One process keeps only a single sweep in
flight: a 15s timer tick that overlaps a long drain joins that run instead of
starting another.

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

Attached operations receive snapshots and `done` even when the user is looking
at another topic. Dispatch writes into that operation’s session/topic
`messagesMap`. Events are refused when `conversationClearGeneration` (destructive
clear/reset/Stop) or `conversationNavigationGeneration` (topic/session switch)
no longer matches the attached operation. The SSE/poll cursor is advanced **after**
`applyEvent`, so a dropped snapshot is not skipped permanently.

`sendMessageInServer` still refreshes the sending conversation and attaches a
returned `operationId` after leave (PC topic switch, mobile back, PWA abort).
`attachConversationGeneration` rebases **navigation** generation to the current
store value but preserves the send-time **clear** generation, so a late response
after clear/delete/reset cannot re-attach. **Stop** bumps a **lane-scoped** clear
epoch (`session/topic:threadId|main`); **topic delete** bumps a **topic-scoped**
tombstone that invalidates every lane in that topic. `cancelActiveDurableOpsInScope`
lists active server operations via a quiet `listActive` call before detaching
local attachments. Lane stop markers block sync re-attach until the next send
clears them. **Clear current conversation** bumps the global clear epoch. `syncActive` does not
reattach operations in `cancelling` status, and skips topics missing from
`topicMaps` once that session’s topic list is loaded. Navigation-only invalidation
re-attaches with the current navigation epoch. Late refresh, attach, reconcile,
and abort recovery are gated on `isAccountMutationCurrent` and `userScope` at
the shared attach boundary so account reset does not write durable state into
the wrong scope. Shared
`chatLoadingIdsAbortController` / `searchWorkflowLoadingIdsAbortController` are
cleared only when the corresponding loading list becomes empty, so one
generation’s `finally` cleanup cannot strip Stop from a sibling in-flight job.
It skips only UI-only work: `switchTopic`, skill move, `addFilesToAgent`, and
browser `internal_execAgentRuntime`. Abort recovery looks up the
`idempotencyKey` unless Stop cancelled the send (`MESSAGE_CANCEL_FLAT` /
`canceled`, or `User cancelled sendMessageInServer operation`). Search-intent
leftover loading (`searchWorkflowLoadingIds`) is cleared in `finally` even after
leave.

On `visibilitychange` → `visible` and `pageshow` with `event.persisted`, the
hook bumps a resume nonce so SSE reconnects and `syncActive` runs. A first-load
`pageshow` without `persisted` is ignored. If the visible conversation has a
`LOADING_FLAT` assistant and `listActive()` has no matching job, `syncActive`
refreshes messages (a job that finished while the user was away and was never
attached). `reconcileConversationGeneration` refreshes the **operation’s**
session/topic, not whichever topic is currently visible.

Title and translation use separate lanes, so their events can attach alongside
chat. Navigation detaches local UI state without cancelling server work.
Explicit Stop, retry/rewind, delete, and clear perform scoped server
cancellation.

Stop still goes through `stopGenerateMessage` / group supervisor stop →
`cancelActiveDurableOpsInScope` → `conversationGeneration.cancel`. Lane stop
markers block sync re-attach until the next send clears them. Durable
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
errors—are persisted to the tool message and its recovery state. HTTP MCP
invocations carry `isHttpMcp` through step serialization; the execute tool loop
reports completion (including thrown failures) to tool diagnostics with
`runtimeType: 'mcp'`. `createConversationRuntimeChatOptions` receives resolved
`runtimePayload.runtimeProvider` (not the raw gateway id) so `DEBUG_*_CACHE`
diagnostics match the SDK family the worker actually calls.

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
dropping a committed sibling. The helper merges only the returned child-id
array back onto the caller; a nested member overlay keeps its model, plugins,
group prompt, and target. A retry that finds a persisted assistant id with
no row recreates the loading placeholder and refuses to finalize success if the
row is still missing. A nested group-agent turn returns an explicit outcome;
failed, cancelled, or interrupted children cannot be overwritten by supervisor
success. Stop, pending cancel, stale finalization, and a failed round clear
leftover loading placeholders in the same transaction as the terminal status
change, then set `placeholdersCleanedAt`. A sweeper keyset-pages unmarked
terminal rows (`finished_at`, `id`, partial index, `SKIP LOCKED`) until none
remain so a crash between those writes cannot leave permanent `LOADING_FLAT`
rows. One bad leftover is rolled back to a savepoint, logged, and skipped for
that pass; later rows in the page and later pages still commit. Successful
sibling replies keep their content and are not annotated with
another member’s error; round-level failure lives on the operation. After a
tool continuation, cancel, clear, and failure annotate or clear the newest
assistant, not the completed tool-call row. Parallel member turns settle before
the parent is finalized.

## Docker runtime overlay

Next marks `graphile-worker` as `serverExternalPackages`, so instrumentation
loads it with Node `require` instead of bundling it. `graphile-worker@0.17.3`
compiles with TypeScript `importHelpers` and therefore
`require('tslib')` from `dist/index.js`. Node only walks `node_modules`
directories from that file upward; it does not search pnpm's `.pnpm` store.

The image therefore installs a separate `/deps` tree with **npm** (hoisted
layout), copies it to `/tmp/deps-node-modules`, removes any standalone pnpm
symlinks that share those package names (`pg`, `drizzle-orm`, scoped
`@graphile/*`, …), then `cp -a` merges the real directories into
`/app/node_modules/`. A direct `COPY /deps/node_modules/ /app/node_modules/`
fails BuildKit with `cannot copy to non-directory` because Next's standalone
`pg` is a symlink
([docker/buildx#150](https://github.com/docker/buildx/issues/150)).
Copying only `graphile-worker` materializes the package directory without
`tslib`, `cosmiconfig`, or `yargs`, and Next fails while loading
`instrumentation` (`Failed to prepare server` / `MODULE_NOT_FOUND`). The app
stage `require('/app/node_modules/graphile-worker')` check fails the image
build if that overlay is incomplete.

`DISABLE_CONVERSATION_WORKER=1` skips worker *start*, not the static import, so
it does not work around a missing `tslib`.

## Diagnostics

`src/instrumentation.ts` calls `bootstrapDebug()` before starting the worker.
Debug env vars are process-wide; the Docker overlay does not strip them.

| Switch | Worker wiring |
| --- | --- |
| `CHATHUB_DEBUG` / `LOG_LEVEL` | Pino level for tRPC. Worker lifecycle uses `[conversation-generation]` console logs. |
| `CHATHUB_TOOLS_DEBUG` | MCP HTTP tools log through `mcpService`. Chat tool turns emit `tool_batch_*` / `tool_completion_reported` from `toolDiagnostics.ts`. |
| `DEBUG_*_CACHE` | `createConversationRuntimeChatOptions` passes `cacheDiagnostics` and `trustedPromptCacheKey` into `runtime.chat`, matching `/webapi/chat/[provider]`. |
| `CHATHUB_KNOWLEDGE_DEBUG` | `injectRag` emits retrieval / vector-search / prompt-injection events; embeddings still log in `RagEmbeddingService`. |
| `CHATHUB_IMAGE_DEBUG` | Unchanged. Image workspace uses `async_tasks`, not this worker. |
| `DEBUG_*_CHAT_COMPLETION` | Provider factories read `process.env` at call time. |

Browser-only switches (`NEXT_PUBLIC_CHATHUB_DEBUG`, `?replacement_debug=1`)
are unchanged.

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
- `scripts/migrateServerDB/dockerfileRuntimeDeps.test.ts`
- `src/hooks/useConversationGenerationSync.test.tsx`
- `src/store/chat/slices/message/selectors.test.ts`
- `src/features/Conversation/Messages/Default.test.tsx`
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
