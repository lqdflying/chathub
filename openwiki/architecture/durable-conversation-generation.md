# Durable Conversation Generation

ChatHub runs topic/session generation on the server so closing a tab, losing
SSE, navigating elsewhere, or restarting a container does not cancel in-flight
work. Explicit Stop and destructive history actions such as retry, rewind,
delete, and clear cancel the matching work.

End-to-end lesson (Claude.ai-like leave-and-keep-going, two producers, RAG /
tool pitfalls):
[Claude-like background generation](claude-like-background-generation.md).
Agent contract: `.cursor/rules/durable-background-generation.mdc`.

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
browser-only tools, and a disabled flag all drop durable enqueue. The user
message is still saved and the connected-tab runtime runs. Enqueue returns a
structured `{ deferred: true, reason }` result for expected browser fallbacks
instead of throwing `UNPROCESSABLE_CONTENT` / `PRECONDITION_FAILED`, so V1 /
regenerate / group paths do not dump tRPC handler stacks. Prompt-only builtins
with an empty `api` (Artifacts / `lobe-artifacts`) are **not** deferred: they
only inject a system role, which the worker already includes. `tryEnqueue` recovers a lane only by `idempotencyKey` after a transport
failure, and never after a typed `CONFLICT`, credential miss, or capability
miss. It must not attach a previous chat job as if it were the new request.

Inbox chat messages are stored with `sessionId IS NULL`. Enqueue persists
`sessionId` through `toPersistedConversationSessionId`, mapping `'inbox'`,
empty, and null to `undefined` so `MessageModel.matchSession` uses `IS NULL`.
Assistant placeholders, tool rows, and supervisor children use
`toPersistedConversationMessageSessionId` (same mapping, `null` instead of
`''`) so inbox writes round-trip through `query({ sessionId: undefined })`.
Lanes still use the public inbox id (`session:{sessionId|inbox}`).
`loadScopedMessages` queries with that normalized session id, and when
`topicId` is present it sets `omitSessionFilter` so already-persisted
`'inbox'` operation rows still load the transcript.

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
Retryable failures return the row to `pending` but **leave `workerJobId` set**.
Graphile still owns that job (`jobKey` = operation id, `maxAttempts` = 8) and
will retry it. Clearing the id made `listPendingWithoutJob` re-enqueue a
second job while Graphile still held the first. The sweeper only re-enqueues
rows whose `workerJobId` is null. Stale `processing` recovery
(`requeueStaleProcessing`) still clears `workerJobId` because the heartbeat is
dead and recovery uses a distinct `jobKey`. Heartbeats cover the whole
operation: a missed heartbeat (no matching `processing` row/attempt) aborts
the local run and feeds `shouldStopGeneration`. Checkpoint/final writes
require the same attempt and lane generation. A terminal row is never rewritten
by a late worker.

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
local attachments. Before that `listActive` await it also promotes every
matching in-flight enqueue into the lane stop markers and tombstones every
attached operation in scope under its own lane key, so an operation that only
becomes visible to the server after the snapshot is still fenced — and an
attached operation whose best-effort cancel fails or is lost cannot be
reattached by a rediscovering sync. Lane
stop markers record three fences per client lane key: cancelled operation ids,
idempotency keys whose enqueue was still in flight at Stop time (tracked in
`durableInFlightEnqueues` from send start until the response settles), and a
**per-server-lane** generation cutoff map
(`laneGenerations[operation.lane]`). Every durable producer registers its
in-flight enqueue with its **kind** — chat send/continue/regenerate, group
supervisor/agent, translation, topic title, and memory compaction — and a lane
Stop only fences chat-family entries, so pressing Stop on a reply never
suppresses a concurrent title, translation, or compaction enqueue. Every
durable producer captures the **full resolved clear fence**
(`resolveConversationClearGeneration`: global epoch + topic tombstone +
chat-family lane epoch) at request start and re-checks it
(`isConversationClearFenceCurrent`) after every pre-registration await and
again before attach — topic deletion never bumps the global epoch, so only the
resolved fence detects it while the active topic id is still unchanged. A
producer that finds the fence stale after its enqueue already returned cancels
the orphaned operation eagerly instead of attaching, and attach always uses the
captured fence token rather than re-resolving a changed fence. Server lane
generations are independent per
lane (main vs portal thread vs group agent), so cutoffs are never projected as a
single scalar onto a thread or topic key: a lane Stop writes only its own lane
key, and a Stop at main-lane generation 5 cannot cancel a portal/group operation
on another server lane at generation 1. Sync re-cancels only exact predecessor
ids, fenced idempotency keys (this closes the race where an operation was
enqueued before Stop but invisible to the `listActive` snapshot), or ops on the
same server lane at or below that lane's cutoff; newer server lane generations
(group supervisor, group agent, or another tab) and deliberate post-Stop sends
(fresh idempotency keys) attach without a local producer callsite. The
idempotency-key fence is **global across markers**
(`isDurableIdempotencyKeyStopped`): when the server auto-creates a topic for a
default-topic send, the operation relocates to the new topic id while the Stop
marker stays on the source lane, so sync checks the key across every marker
before attaching. `sendMessageInServer` additionally captures an immutable
source fence context at enqueue; when a fenced late response arrives after the
relocation it cancels the orphaned server operation immediately instead of
waiting for sync. Only a
topic-wide tombstone (topic delete) writes the topic marker key, still with
per-server-lane cutoffs. Failed or deferred sends do **not** clear markers at
send start. **Topic delete** installs its tombstone synchronously before the
first `await`, then performs best-effort server cancellation. **Bulk topic
deletion** (`removeSessionTopics`, `removeGroupTopics`, `removeAllTopics`,
`removeUnstarredTopic`) fences before the first server delete await, with a
scope that reflects what the server actually deletes. Exact-ID deletes
(`removeGroupTopics`, `removeUnstarredTopic`) remove only the client-supplied
ids, so they install a topic-scoped epoch bump + tombstone for every target
topic (collecting attached operations and registered in-flight keys into the
markers) and cancel with a `topicIds` scope matching operations by their
globally unique topic id. Server-authoritative deletes fence more than any
loaded map: `removeSessionTopics` maps to `batchDeleteBySessionId` (every topic
row in the session) and `removeAllTopics` to `deleteAll` (every user topic), so
they tombstone every client-known topic (the union of loaded maps and
attached-operation topic ids) and then cancel with an
`allSessionTopics` / `allAccountTopics` scope that matches every non-null-topic
attached operation, registered in-flight key, and late `listActive` operation
in the session / account — including topic ids the client has not loaded (an
unloaded id is fenced into its lane marker rather than a topic-key tombstone).
In all cases work attached to the (virtual) default topic, and to surviving
starred topics on an unstarred delete, is never cancelled.
**Clear current
conversation** and **clear all topics history** do the same with a topic-wide /
session-wide destructive tombstone (`markConversationTopicDurableGenerationStopped`
/ `markAllDurableGenerationsStopped`) that collects attached operations and
registered in-flight enqueues before the first `await`, then bump the global
clear epoch; `clearChatLoadingLaneMaps` deliberately keeps the markers so a
pre-clear job cannot reattach when sync discovers it. `syncActive` does not
reattach operations in `cancelling` status, and skips topics absent from a
loaded `topicMaps` entry (an explicitly empty list means the topic was removed).
Event application and attach/reconcile resolve the clear epoch **per kind**
(`resolveConversationClearGeneration`): non-chat kinds ignore the lane-scoped
component, so the lane epoch bump from a chat Stop does not invalidate a
translation or title operation that shares the client lane.
Navigation-only invalidation re-attaches with the current navigation epoch. Late refresh, attach, reconcile,
and abort recovery are gated on `isAccountMutationCurrent` and `userScope` at
the shared attach boundary so account reset does not write durable state into
the wrong scope. Per-lane `chatLoadingAbortControllersByLane` pair with
`chatLoadingLaneByMessageId`; the legacy global `chatLoadingIdsAbortController`
tracks the latest-started lane only and is not used for lane-scoped Stop.
Lane maps are cleared on normal completion (with thread scope in `finally`),
conversation clear, invalidate, and account reset via `abortAllChatLoadingLanes`
/ `clearChatLoadingLaneMaps`. Legacy global `chatLoadingIdsAbortController` and
`searchWorkflowLoadingIdsAbortController` are cleared only when the corresponding
loading list becomes empty, so one generation’s `finally` cleanup cannot strip
Stop from a sibling in-flight job.
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
attached). `syncActive` also deletes **orphaned** `LOADING_FLAT` placeholders:
assistant rows whose content is still the placeholder but which have no client
loading id, no attached server operation, and a `createdAt` older than the
5-minute grace window (`ORPHAN_PLACEHOLDER_GRACE_MS`). These are the remains of
interrupted browser-fallback turns (Stop before any chunk, closed tab, or a
pre-fix client that dropped a finished reply on navigation); without cleanup
they render as a dead empty bubble forever. The grace window protects a live
producer in another tab that may still finalize the row.
`reconcileConversationGeneration` refreshes the **operation’s**
session/topic, not whichever topic is currently visible.

Title and translation use separate lanes, so their events can attach alongside
chat. Navigation detaches local UI state without cancelling server work.
Explicit Stop, retry/rewind, delete, and clear perform scoped server
cancellation.

Stop still goes through `stopGenerateMessage` / group supervisor stop →
`cancelActiveDurableOpsInScope` → `conversationGeneration.cancel`. Lane stop
markers fence only the cancelled predecessor ids, in-flight idempotency keys,
and the per-server-lane generation cutoff. Retry/rewind aborts the chat lane
controller plus the **discarded messages'** per-message `pluginApiAbortControllers`;
the shared tools/reasoning/search controllers are bookkeeping-only (no fetch
consumes them) and are released only when the rewind empties their id list, so a
scoped retry never cancels a sibling lane's auxiliary work.
Durable generating UI uses `internal_markDurableGenerating` so it does not install
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

The worker currently supports builtin web browsing, Code Interpreter
(DifySandbox sidecar), fixed Memory, activated skills, HTTP MCP, and
prompt-only builtins with an empty `api` (Artifacts / `lobe-artifacts`).
Enabling Code Interpreter does not block enqueue. If the model calls it, the
worker posts to `POST /v1/sandbox/run` and continues (`shouldContinue: true`)
even when the sidecar is unset (`not_configured`) or the program fails.
Image generation (DALL·E / image-designer chat tools), non-HTTP MCP, and
unknown plugin runtimes are still capability-gated before durable enqueue, so
the existing browser runtime handles the whole conversation rather than
receiving a fake server success. Pre-send compaction also stays on the client
because it must finish before the user message is committed.

Background compaction is different: the client runs the normal eligibility and
prefix planner, then stores a non-secret plan snapshot with candidate message
IDs, prior summary/cursor, fingerprint, watermarks, and expected conversation
version. The worker batches that exact prefix and atomically verifies/persists
the summary, cursor, archives, and bounded debug log. An edit, delete, clear, or
other invalidation makes the operation `interrupted` instead of committing a
stale summary. Compaction (`memory_compaction` and the client pre-send
summarizer) keeps the prompt/summary cap at 400 tokens but, for thinking
models, raises the API `max_tokens` by 2048 and sends documented thinking-off /
lowest-effort fields. Title, language-detect, and translation share
`runSimpleCompletion` sampling (thinking-off / GPT-5 effort) but **do not**
inherit that 400-token output cap — `chainTranslate` has no `max_tokens`.
Native OpenAI Responses (for example `gpt-5.5`) maps the generic budget to
`max_output_tokens`. Thinking-off is sent only where the vendor documents it
(Anthropic `thinking: { type: 'disabled' }`; DeepSeek V4
`thinking: { type: 'disabled' }`; Moonshot/Zhipu thinking-type APIs). Unlisted
custom History Compress models get the extra budget without inheriting a
foreign card's thinking fields. GPT-5 uses `resolveGPT5ReasoningEffort(model,
'minimal')` (`gpt-5-mini` → `minimal`; `gpt-5.5` / `gpt-5.6-sol` stay at the
quality floor `high`). Visible text only is stored; reasoning SSE is dropped.
An empty compaction summary throws
`EmptyCompactionSummaryError` and finalizes `failed` once — it does **not**
enter Graphile's 8-attempt loop. `TitleTranscriptEmptyError` still uses the
delayed title retry, because that is a transcript-binding race.

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

`DISABLE_CONVERSATION_WORKER=1` skips worker _start_, not the static import, so
it does not work around a missing `tslib`.

## Diagnostics

`src/instrumentation.ts` calls `bootstrapDebug()` before starting the worker.
Debug env vars are process-wide; the Docker overlay does not strip them.

| Switch                        | Worker wiring                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CHATHUB_DEBUG` / `LOG_LEVEL` | Pino level for tRPC. Worker lifecycle uses `[conversation-generation]` console logs.                                                                   |
| `CHATHUB_GENERATION_DEBUG`    | Send-path diagnostics for this engine itself: client send/attach/sync decisions re-emitted via `reportClientDebug`, plus enqueue/sweep/execute events. |
| `CHATHUB_TOOLS_DEBUG`         | MCP HTTP tools log through `mcpService`. Chat tool turns emit `tool_batch_*` / `tool_completion_reported` from `toolDiagnostics.ts`.                   |
| `DEBUG_*_CACHE`               | `createConversationRuntimeChatOptions` passes `cacheDiagnostics` and `trustedPromptCacheKey` into `runtime.chat`, matching `/webapi/chat/[provider]`.  |
| `CHATHUB_KNOWLEDGE_DEBUG`     | `injectRag` emits retrieval / vector-search / prompt-injection events; embeddings still log in `RagEmbeddingService`.                                  |
| `CHATHUB_IMAGE_DEBUG`         | Image **workspace** (`/image`) uses `async_tasks`. Chat Image tool tiles use `CHATHUB_GENERATION_DEBUG` (`chat_image_*`). |
| `DEBUG_*_CHAT_COMPLETION`     | Provider factories read `process.env` at call time.                                                                                                    |

Browser-only switches (`NEXT_PUBLIC_CHATHUB_DEBUG`, `?replacement_debug=1`)
are unchanged.

### CHATHUB_GENERATION_DEBUG send-path instrumentation

The send path has decisions that no other switch can see: the client silently
returns on guard failures (`sendMessageInServer` guards, `internal_resendMessage`
anchor/retry guards, `tryEnqueueConversationGeneration` swallowing
non-recoverable errors), and the server never logged whether a Graphile job was
actually added for an operation row. `CHATHUB_GENERATION_DEBUG` closes that gap.

- Server emitter: `src/libs/logger/generationDebug.ts`
  (`logGenerationDebugSafe`), namespace `chathub-generation-debug`, same
  prefixed-JSON line format and sanitizers as `chathub-tools-debug`
  (`sanitizeSafeRecord` / `fingerprintString` exported from `toolsDebug.ts`).
- Client emitter: `src/libs/logger/generationDebugClient.ts`. Gated by
  `GlobalServerConfig.generationDebug` (set from the env var in
  `getServerGlobalConfig`) with a `localStorage['chathub.generationDebug']`
  override; queues events and flushes fire-and-forget (2 s or 20 events, plus
  `pagehide`) through `conversationGeneration.reportClientDebug`, which
  re-sanitizes the fields as untrusted input and re-emits them with
  `side:'client'`.
- Correlation: each send/regenerate creates a client `spanId` (`gd_...`),
  carried as `generation.debugSpanId` through `AiSendMessageServerSchema` /
  `ConversationGenerationEnqueueSchema` into the server enqueue events.
  Browser-fallback deferrals store that same `spanId` on
  `deferredBrowserGenerationLanes` so   `deferred_lane_*`, `topic_busy_changed`,
  `builtin_tool_settled`, `invalidate_preserved`, `rag_retrieve_settled`,
  `message_persist_skipped`, `chat_image_*`, and client `tool_batch_*` (`generationSpanId`) can
  join one leave/return turn. Identifiers are `sessionHash` / `topicHash` /
  `threadHash` / `messageHash` (sha256-16); raw ids never appear.

Event coverage:

| Layer  | Events                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Client | `send_started`, `send_rpc_settled` (`stillCurrent`, `topicChangedDuringRpc`, readable `deferReason` / `reason`), `send_recovery`, `send_failure_ui`, `durable_attach`, `durable_attach_skipped`, `browser_path_started` (`skipped`/`reason=notCurrent` when the send RPC returned after the user left and there was no deferral), `exec_runtime_settled` (`stillCurrent`; `kind=continue` on post-tool model fetches), `fetch_stream_interrupted` (`errorKind=webkit_load_failed\|failed_to_fetch\|abort`, `classifiedAs=abort`, `hasOutput`, `outputChars`, `signalAborted`), `fetch_stream_error` (`classifiedAs=error`), `enqueue_client_settled`, `regenerate_started`, `regenerate_early_return`, `regenerate_enqueue_settled`, `deferred_lane_marked`, `deferred_lane_left` (`type=navigation\|visibility`, `producerAlive`), `deferred_lane_resumed` (`outcome=resume_tools\|resume_model\|finalize\|still_producing\|loading_flat`; `still_producing` also has `chatLoading` / `toolsCalling` / `streamActive` / `pendingModelContinue` / `pendingTools`), `deferred_lane_aborted` (`type=stop\|topic_delete\|clear`), `deferred_placeholder_finalized`, `tool_loop_continue` / `tool_loop_continue_skipped` (`reason=batch_gated\|not_alive\|no_tools\|no_resumable_tool\|session_changed\|not_visible`, plus outcome counts), `topic_busy_changed` (idle→busy / busy→idle only), `builtin_tool_settled` (`toolName` / `operation`, using the tool's conversation + deferred `spanId`, not the topic you clicked), `invalidate_preserved` (plugin / RAG / search / chat-loading kept vs aborted counts), `rag_retrieve_settled` (`ok` / `hard_cancelled` / `empty` / `error` plus `chunkCount`), `message_persist_skipped` (`reason=hard_cancelled` / `not_visible`), `chat_image_run_started` / `chat_image_item_settled` / `chat_image_run_settled` (`toolName=lobe-image-designer`, `visible`, `outcome`, counts; never prompts), `sync_summary` (`reason` trigger, `deferredLaneCount`, `resumedTools`, `resumedModel`), `orphan_deleted`, `event_dropped`, `event_applied_terminal`, `sse_client_stream_ended`, `sse_client_stream_failed`, `sse_client_poll_failed`, `sse_client_reset_replay` |
| Server | `enqueue_received`, `enqueue_rejected`, `enqueue_persisted` (`jobAdded`), `sandbox_run_started` / `sandbox_run_settled` (`outcome`, `httpStatus`, `exitCode`, counts; never code/stdout/filenames), `browser_tool_stubbed` (`toolName`, `shouldContinue`, `operationHash`; DALL·E only), `chat_image_task_created` (`inserted`/`idempotent`) / `chat_image_task_rejected` (`uncorrelated` / `unproven` / `stopped` / `conflict`; `unproven` is a UUID that does not derive from this request's principal aliases plus message/index/attempt; `stopped` is only `ChatImageTaskCancelled`, never a generic provider error; hashed message/task ids, never prompts), `sweep_reenqueued` (`jobAdded`), `worker_started`, `worker_start_failed`, `worker_stopped`, `job_received` (`queueAgeMs`), `job_malformed`, `sweep_failed`, `sse_opened`, `sse_closed` (`deliveredCount`, `reason`), `sse_reset`, `sse_poll_failed`, `execute_started` (`queueAgeMs`), `execute_skipped`, `execute_transcript_loaded`, `execute_retrying`, `execute_settled`               |

Semantics that matter when reading the stream:

- `enqueue_rejected` is also emitted from `sendMessageInServer` when durable
  enqueue is dropped before `ConversationGenerationService.enqueue` runs
  (`reason=unsupported_tool` with `toolName`, or `reason=fetch_on_client`).
  Those sends share the client `spanId` and then take the browser path.
- `enqueue_persisted.jobAdded` is always true on the transactional send path —
  a failed SQL `add_job` rolls the enqueue back (the client then sees an RPC
  error). The reachable `jobAdded=false` signal is `sweep_reenqueued`: the
  operation row exists, but neither the SQL insert nor the worker-utils
  fallback could add a job; the sweeper retries on its next pass.
- Worker lifecycle: `worker_started` fires once per container boot from
  `startConversationGenerationWorker`; a boot showing `worker_start_failed`
  (or no `worker_started`) means the Graphile runner never came up and no job
  will run until restart. `job_malformed` covers payloads dropped for missing
  `operationId`/`userId`; `sweep_failed` names the failing sweeper phase.
- Queue latency: `job_received.queueAgeMs` (Graphile `run_at` → claim) and
  `execute_started.queueAgeMs` (operation `createdAt` → claim) separate queue
  backlog from stuck execution.
- Delivery: the SSE route (`webapi/conversation-generation/stream`) brackets
  each connection with `sse_opened`/`sse_closed` and counts delivered events;
  the client hook reports reconnect episodes (`sse_client_stream_ended` /
  `sse_client_stream_failed`), throttled poll failures, and cursor-reset
  replays. `event_dropped` in `applyConversationGenerationEvent` names why an
  event was not applied (`not_attached`, `stale_revision`); snapshot drops are
  throttled to one per operation+reason while `done`/`error` drops are always
  logged. `event_applied_terminal` is the positive end-to-end proof that a
  terminal event reached and was applied by the browser.
- `execute_transcript_loaded` is emitted from `loadScopedMessages` for chat,
  title, compaction, and supervisor loads. It records `transcriptCount`,
  `omitSessionFilter`, `persistedSessionNull`, `hasTopicId`, plus
  `parentUserHash` (content fingerprint of the triggering user message) and
  `lastTranscriptUserHash` (last user message actually loaded). A hash
  mismatch proves a transcript/binding race — the worker answered a different
  user turn than intended. `transcriptCount=0` with `omitSessionFilter=true`
  is the empty-title load, not a missing job.
- `execute_started` / `execute_retrying` / `execute_settled` include readable
  `model` and `provider` labels (allowlisted; session/topic ids stay hashed).
- `execute_retrying` fires when `markForRetry` succeeds. Graphile still owns
  that job; `errorClass` names the throw (for example
  `TitleTranscriptEmptyError`). `sweep_reenqueued` is a different path (null
  `workerJobId` or stale-heartbeat recovery). Empty compaction summaries do
  **not** emit `execute_retrying`; they finalize `failed` with
  `EmptyCompactionSummaryError` and numeric `contentChars` / `reasoningChars`.
- `execute_settled` is terminal only (`succeeded` / `cancelled` / `failed` /
  `interrupted`); retries do not emit it.
- Claude-like leave/return (browser-fallback turns): `deferred_lane_marked`
  when durable enqueue is rejected for a browser-only tool; `deferred_lane_left`
  when the user switches topic/session/thread or hides the tab while that
  marker exists (`producerAlive` says whether the tab is still generating);
  `deferred_lane_resumed` when they return (`resume_tools` / `resume_model` /
  `finalize` / `still_producing` / `loading_flat`); `deferred_lane_aborted` for Stop /
  topic delete / clear. `sync_summary.reason` is
  `initial` / `topic_change` / `session_change` / `thread_change` /
  `visibility`. A healthy off-screen browser turn is
  `send_rpc_settled(deferReason=unsupported_tool)` → `deferred_lane_marked` →
  `deferred_lane_left(producerAlive=true)` → `tool_loop_continue`
  (`visible=false`) without waiting for return. `deferred_lane_resumed` on
  return is `still_producing` if that continue already started, or
  `resume_tools` / `resume_model` / `deferred_placeholder_finalized` only as
  backup.
  The healthy off-screen path after MCP is `call_tool_complete` (or client
  persist) → `tool_loop_continue` while you are still on the other topic
  (`visible=false` is expected). `resume_model` on return is only a backup
  if that continue was skipped. `tool_loop_continue_skipped` names why
  the model did not start (`no_resumable_tool` = cancelled/empty results;
  `batch_gated` = topic not visible and no deferred lane). On leave,
  `no_resumable_tool` plus `cancelledCount` right after a persisted MCP
  result is the abort-on-switch regression, not a healthy skip.
  A healthy off-screen RAG / builtin / persist path on the same `spanId` is
  `invalidate_preserved` (plugin/RAG/search/chat loading kept, not aborted) →
  `rag_retrieve_settled(outcome=ok|empty)` and/or `builtin_tool_settled`
  (`visible=false`, `sessionHash`/`topicHash` of the left conversation) →
  `tool_loop_continue`. During retrieve, `deferred_lane_left` must have
  `producerAlive=true` (assistant is on `chatLoadingIds`, or the user RAG row
  is in `messageRAGLoadingIds`). `producerAlive=false` with a later
  `rag_retrieve_settled(ok)` is the empty-Reference-Source hang: retrieval
  finished but the placeholder was treated as a dead `LOADING_FLAT` row.
  `rag_retrieve_settled(outcome=hard_cancelled)` is Stop
  / account switch, not leave. `message_persist_skipped(reason=not_visible)`
  should be rare after persist-context inference; `hard_cancelled` is Stop.
  `still_producing` on return with `toolsCalling=false`,
  `pendingModelContinue=true`, and no earlier `tool_loop_continue` is the
  leftover hang that `resume_model` covers.
  `send_rpc_settled(stillCurrent=false, topicChangedDuringRpc=true)` without
  a later `deferred_lane_marked` is the known send-RPC race.
- `topic_busy_changed` is transition-only (the topic-list spinner). Initial
  idle mounts are silent. Boolean flags: `sendRpc`, `durableJob`,
  `deferredLane`, `producing`, `tools`, `topicCrud`.
- `builtin_tool_settled` is generation-debug (not tools-debug) so an
  off-screen web search or leftover-tab builtin is visible when only
  `CHATHUB_GENERATION_DEBUG` is on. It is emitted from `invokeBuiltinTool`
  for every builtin (`toolName` = identifier, `operation` = apiName) and
  uses the **tool message's** conversation plus that assistant's deferred
  `spanId`, not `activeTopicId`. `outcome` is `completed` / `skipped` /
  `cancelled` / `failed` / `error`. `visible=false` is expected after leave.
- `invalidate_preserved` fires on topic/session switch when anything was
  in flight. Compare `preservedPluginCount` vs `abortedPluginCount` (and the
  RAG / search / chat-loading counterparts). Aborted plugin/RAG on a deferred
  lane is the abort-on-switch regression.
- `rag_retrieve_settled` distinguishes `ok` (chunkCount>0), `empty` (0 chunks
  found), `hard_cancelled` (Stop / account switch), and `error`. Leave is not
  `hard_cancelled`.
- `message_persist_skipped` names why `internal_updateMessageContent` returned
  before writing: `hard_cancelled` (Stop / account) vs `not_visible` (should
  be rare after inactive-map persist inference).
- Chat Image tool tiles (`lobe-image-designer`) emit `chat_image_run_started`,
  `chat_image_item_settled`, and `chat_image_run_settled` on the deferred-lane
  `spanId` (`CHATHUB_GENERATION_DEBUG`, not `CHATHUB_IMAGE_DEBUG`).
  `visible=false` after leave is expected. Run `outcome=persist_unproven`
  means the origin map write could not be proven; `no_model` means config
  was not ready. Server `chat_image_task_created(outcome=inserted)` is the
  billable insert. `fetch_stream_interrupted(errorKind=webkit_load_failed)`
  with no `chat_image_run_started` means Safari aborted during think before
  tools started ([iOS fetch "Load failed"](https://stackoverflow.com/questions/71280168)).
- Sanitization is identical to tools debug: free-form strings are fingerprinted
  (`{hash,length,type}`), safe labels/identifiers pass through, secret-keyed
  fields are dropped, records are capped at 16 KiB. Message content never
  appears; content comparisons use `hashGenerationDebugValue` /
  `hashGenerationDebugClientValue` (both sha256-16, so client and server
  hashes compare).

## Troubleshooting

### Empty title payload rejected by the provider

Symptom: `topic_title` operations fail with a generic
`The upstream stream could not be opened.` error, and the debug
`requestPayload` shows a user message with `content: ""`.

Root cause: `chainSummaryTitle` joins the scoped messages into one user
message. When `loadScopedMessages` returns no rows (for example the title
operation runs before messages are bound to the topic scope), the join
produces an empty string. Strict providers reject the whole request on any
empty message content — Moonshot returns 400 `invalid_request_error`
("content must not be empty"); OpenAI and others behave the same.

Three defenses are in place:

- `executeTitle` (`src/server/services/conversationGeneration/execute.ts`)
  throws a typed `TitleTranscriptEmptyError` when no scoped message has
  non-blank content, so no provider ever receives an empty conversation. For a
  dedicated `topic_title` operation the bounded retry mechanism
  (`markForRetry` + Graphile backoff, up to `CONVERSATION_GENERATION_MAX_ATTEMPTS`)
  re-runs the job once the message-binding race resolves and the transcript is
  loadable. Auto-title is therefore **guaranteed**: a raced topic keeps retrying
  until it gets a title, and only finalizes `failed` if the transcript is still
  empty after the last attempt. The **inline** title pass that runs at the end
  of a chat operation must never fail or retry the completed reply, so it wraps
  `executeTitle` in a guard: on any error it re-checks the stop state and, if
  still active, hands the title off to a fresh dedicated `topic_title`
  operation (`handoffInlineTitle`, idempotency key `<chatOpId>:title-handoff`,
  inheriting model/provider/locale/thread/conversationVersion). The handoff is
  **durable**, not best-effort: it enqueues through the public version-locked
  path, and a `CONFLICT` is treated as "already covered" only after verifying
  the active lane owner is itself a `topic_title` operation. Any other enqueue
  failure persists a pending `topic_title` row with no worker job
  (`persistPendingTitleMarker`), which the pending sweeper re-enqueues, so the
  guaranteed title survives a failed inline enqueue. Only a cleared/advanced
  conversation (`ConversationWriteRejectedError`) legitimately drops it. The
  chat reply always succeeds regardless of the handoff outcome.
- `dropFullyEmptyMessages` (`packages/utils/src/emptyChatMessages.ts`) is
  applied in the shared OpenAI-compatible factory
  (`packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`) for Chat
  Completions, but only **after** provider normalization (`handlePayload`) so
  adapters have already translated semantic fields. It drops a message only when
  its role is `user`/`assistant`/`system`/`developer` (`developer` is the
  o-series / GPT-5 rename of `system` applied by `pruneReasoningPayload`), it
  carries no semantic fields (`tool_calls`, legacy `function_call`,
  `reasoning`/`reasoning_content`/`reasoning_details`), and its content is
  empty; `tool` and `function` messages are always kept so tool_call/tool_result
  and function_call/function pairing survive. Because conversion can itself
  strip semantic fields for some providers (e.g. `openaicompatible` drops
  `reasoning_content`), the factory runs a second drop pass on the final
  converted representation. Responses mode sanitizes separately in
  `convertOpenAIResponseInputs`
  (`packages/model-runtime/src/core/contextBuilders/openai.ts`), which drops
  fully-empty textual input items after conversion but never drops
  `function_call` / `function_call_output` items.
- `enqueueIteratorError`
  (`packages/model-runtime/src/core/streams/protocol.ts`) synthesizes the real
  upstream message from a thrown `ChatCompletionErrorPayload`. Provider
  factories nest the message at varying depth (Moonshot `error.message`;
  OpenAI SDK `APIError` wraps it as `error.error.message`), so the resolver
  walks the nested `error` chain for the first non-empty string `message`,
  falling back to `provider: errorType`. When a simple completion
  (title/translation/compaction) fails upstream, `runSimpleCompletion` throws a
  typed `UpstreamCompletionError` carrying the full structured stream error
  (provider, errorType, HTTP status, raw body); `toError` persists that
  structured body on the operation so operators can tell which upstream
  rejected the request, not just the human-readable message. The message appends
  the error type only when it is not already present, so persisted operation
  errors carry the upstream detail without double-encoding the type.

Product decision (resolved): when the scoped transcript is not yet loadable,
durable auto-title is **guaranteed**, not best-effort. `executeTitle` throws a
retryable error instead of finalizing `succeeded`, so the bounded retry loop
re-checks the transcript on each attempt and the topic eventually receives a
title once message-to-topic binding lands. A transcript that is still empty
after the final attempt finalizes the operation as `failed` with the
transcript-empty error.

### Empty memory-compaction summaries (thinking models)

Symptom: `memory_compaction` operations fail with
`Memory compaction returned an empty summary.`, often after Graphile retried
the same job many times on older images. Generation-debug may show
`kind=memory_compaction` with `contentChars=0` and a non-zero `reasoningChars`.
The compaction model is **Settings → System Agent → History Compress**
(default `gpt-5-mini` / `openai`), not the chat model.

Root cause: `runSimpleCompletion` used to send `max_tokens: 400` and return
only visible `content`. Reasoning/thinking tokens share that completion budget
([OpenAI reasoning](https://platform.openai.com/docs/guides/reasoning);
[Anthropic extended thinking](https://docs.anthropic.com/en/docs/about-claude/models/extended-thinking-models)).
A thinking model can spend the cap on hidden reasoning; `consumeProtocolResponse`
then yields empty text. A generic `Error` used to re-enter Graphile's 8-attempt
loop with the identical payload.

Fix: `buildSimpleCompletionSampling` (`src/helpers/contextCompaction.ts`)
raises the API budget for listed reasoning cards and unknown/custom model IDs,
and sends documented thinking-off / lowest-effort fields only for known
providers (Anthropic, DeepSeek V4, Moonshot/Zhipu thinking-type APIs; GPT-5
effort). Compaction passes an explicit 400-token summary cap; translation and
title omit `max_tokens`. Native OpenAI Responses remaps that budget to
`max_output_tokens`. Empty visible text throws `EmptyCompactionSummaryError`,
which `executeConversationGeneration` finalizes as `failed` (or `interrupted`
if the lane was already superseded) without `markForRetry`. Do not copy
reasoning into `historySummary`.

### Browser-fallback reply lost after switching topics (empty bubble)

Symptom: a turn that ran in the browser (durable generation deferred, e.g. a
plugin with a browser-only runtime) completed — server logs show the stream
finishing with dozens of chunks — yet when the user returns to the topic from
history the assistant bubble is an empty white circle.

Root cause: `internal_fetchAIChatMessage`
(`src/store/chat/slices/aiChat/actions/generateAIChat.ts`) guarded its
`onFinish` finalization with `isCurrentConversation()`, which includes
`activeId`/`activeTopicId` equality. When the user switched topics while the
stream was still running, the finished reply was discarded instead of
persisted, leaving the assistant row permanently at `LOADING_FLAT`.
`InterruptibleLoading` (`src/features/Conversation/Messages/Default.tsx`) then
renders nothing for a stale, non-generating placeholder — the white circle.

Product contract for deferred browser turns:

- Persist the first assistant off-screen under `isPersistenceCurrent()`
  (account snapshot + clear fence). Navigation alone does not block the write.
- Keep a started tool batch alive after leave: do not abort in-flight plugin
  controllers whose parent is a deferred assistant, do not rewrite a
  successful MCP **or builtin** result as `cancelled` just because the topic
  is inactive, and always clear `messageInToolsCallingIds` in `finally`.
  Knowledge Base / RAG retrieval uses the same hard-cancel fence (account +
  clear generation), not `activeTopicId`. Browser-fallback RAG also puts the
  **assistant** on `chatLoadingIds` for the whole retrieve + model path, so
  leave-topic `producerAlive` stays true and `InterruptibleLoading` does not
  collapse the placeholder into a white circle under Reference Source.
  Continue the model immediately via
  `triggerAIMessage` with the original `conversationContext`. On return,
  `resume_model` only if that continue was skipped and tools already have
  results with no follow-up assistant.
- Stop with no text still **deletes** the empty row. Topic switch does not
  abort deferred producers, so `onAbort` is Stop / lost fetch, not Leave.
- Finalize never blanks leftover `LOADING_FLAT` into a white circle. Sync
  clears the deferred marker only after persist wrote real content, resumes a
  pending tool skeleton, or resumes a pending model continue.

How that is implemented:

- `onFinish`, `onMessageHandle`, and `onErrorHandle` persist under
  `isPersistenceCurrent()`. `internal_updateMessageContent` receives the
  captured `conversationContext`.
- Topic switch (`internal_invalidateConversation`) does not abort
  AbortControllers or strip `chatLoadingIds` for deferred browser-fallback
  lanes, including `pluginApiAbortControllers` keyed by **tool** message ids
  and `messageRAGLoadingIds` for user rows in that conversation. Deferred
  lanes are keyed by
  `laneScopedClearKey(sessionId, topicId, threadId)`.
- `sendMessageInServer` returns `deferReason` / `deferredToolName` on the RPC
  success path (it does not throw). The client stores that marker in
  `deferredBrowserGenerationLanes`.
- `syncActiveConversationGenerations` on switch-back resumes leftover tool
  calls when the row has `tools` and no tool results, and resumes the model
  when tool results exist but there is no follow-up assistant. It never
  toggles loading off a leftover `LOADING_FLAT` row. Deleting the topic aborts
  and clears those deferred lanes.
- `topicSelectors.isTopicLoading` drives the spinning icon on the topic list.
  It is true for durable `serverGenerationOperations`, in-flight browser
  `chatLoadingLaneByMessageId` / plugin / tool / reasoning / RAG / search
  workflow ids in that topic’s `messagesMap`, a deferred browser lane that is
  still `LOADING_FLAT`, waiting to resume tools, or waiting for a model
  continue after tool results, and `mainSendMessageOperations` while the send
  RPC is in flight. Topic CRUD still uses `topicLoadingIds`.
- `syncActiveConversationGenerations` still deletes orphaned stale placeholders
  (see Client sync), which also repairs rows stuck by the pre-fix behavior the
  next time the topic is opened.

Switch during the **send RPC** (marker not created yet) remains a known gap:
`mainSendMessageOperations` are always aborted on invalidate.

Browser-fallback tool loops no longer require the conversation to stay visible
for HTTP MCP / default tools: leaving the topic does not cancel a successful
tool result, does not leak `messageInToolsCallingIds`, and continues the
model in the same tab immediately (`tool_loop_continue`, possibly
`visible=false`). `resume_model` on return is only if that continue was
skipped. Code interpreter / image-designer still cannot run on the Graphile
worker; the connected tab is the producer for those turns. Durable worker
turns are unaffected because the worker already runs the loop server-side.

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
- `src/store/chat/slices/topic/selectors.test.ts`
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
