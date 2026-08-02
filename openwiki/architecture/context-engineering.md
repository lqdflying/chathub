# Context Engineering and Message Pipeline

ChatHub does not send raw UI messages directly to the model provider. Instead, it runs conversation state through a context-engineering pipeline that injects roles, rewrites content, resolves placeholders, and reorders tool messages before the provider call.

## Pipeline entrypoint

The main entrypoint is `src/services/chat/contextEngineering.ts`. It constructs a `ContextEngine` pipeline from `packages/context-engine` and then feeds it the current message list. The pipeline currently includes:

- history truncation
- system-role injection
- two-tier agent memory injection (fixed + dynamic)
- inbox guide injection
- tool system-role injection
- history summary injection
- input template processing
- placeholder variable processing
- message content processing
- tool call processing
- tool message reordering
- message cleanup

Agent memory sits immediately after the system role on purpose: the rarely-changing
memory block stays in the stable prompt prefix (fixed memory changes only on user
edits, dynamic memory at most daily), ahead of the more volatile inbox/tool/summary
blocks, which preserves provider prompt-cache hit rates.

## Chat Instruction composition

The top-level `Chat Instruction` is persisted inside the existing user general settings JSON and is
composed at request time rather than copied into assistant definitions or topics.
`src/services/chat/index.ts` trims and joins the Chat Instruction before the active assistant role
with one blank line, then passes the effective role into `contextEngineering` for normal assistant
requests. If an imported or custom history already begins with a system message, normal assistant
requests prepend the composed role to that content so the provider still receives one consolidated
initial system message. Other context-engineering callers retain the default behavior of preserving
an existing system message unchanged.

Group-member generation uses the same composer before adding group-member guidelines, and token
estimation mirrors that composition so the displayed context budget includes the shared instruction.

The instruction applies only to normal assistants and group members. It is deliberately excluded from
group supervisor prompts, title and summary generation, translation, search-intent detection, preset
tasks, and other internal automation. Changing the instruction changes the static system-role prefix;
that intentionally invalidates provider prompt-cache entries for the affected assistant while keeping
the composed prefix stable across turns until the setting changes again.

## Why it exists

This pipeline is the reason the app can support features like:

- assistant-specific system prompts
- session-level inbox guidance
- history summaries and compaction
- tool calls and tool role injection
- file/image context handling
- provider-specific formatting for messages and placeholders

## Skill instruction loading

Skill metadata is included in the request context only when the active
assistant has skills enabled. The full `SKILL.md` body is resolved after turn
activation, either from picker/slash-command metadata or from the hidden
`load_skill` builtin. `SkillInstructionsProvider` keeps the metadata and body
blocks separate, so installing or enabling a skill does not inject its
instructions into unrelated turns. See [Agent Skills](../integrations/skills.md)
for the storage, source validation, and activation contract.

## Context allocation and export

The token popover separates `Chat Instruction`, `Role Settings`, plugin settings,
history summary, group orchestration, supervisor input, and chat messages. The
displayed total preserves the separator cost used by the composed prompt. Group
estimates use a representative member prompt and do not count the same response
instruction as both orchestration and chat history. Portal and thread estimates
use their own raw conversation source with the current history-count settings,
so their allocation does not reuse the main-chat message history or become
stale when the history limit changes.

`Context Export` is a transient, one-shot diagnostic. The user arms it from the
regular or group token popover, and the arm is consumed only by the next accepted
user send. Empty-input attempts, persistence-only sends, retries, welcome
prompts, manually started supervisors, and internal automation do not consume
the arm. A regular capture includes the causal assistant request and tool
continuations. Portal sends consume the same arm only after their user message
is persisted. A group capture keeps the supervisor request, selected member
requests, and tool continuations in sequence order.

Each captured request has two layers:

1. `Engineered Context` is the sanitized runtime payload after context
   engineering, history handling, tool generation, file/image resolution, model
   options, and provider-specific trimming.
2. `Provider Request` is the sanitized semantic SDK request immediately before
   the provider client dispatch. It preserves native shapes such as OpenAI
   `input`/`instructions`, Anthropic `system`/`messages`, and Gemini
   `systemInstruction`/`contents`. It is not byte-exact HTTP: SDK serialization,
   authentication, headers, and transport metadata occur afterward.

Chat requests deliver provider snapshots through the dedicated
`context_snapshot` SSE event. Supervisor structured-output requests use the
capture-aware tRPC procedure. The arm is consumed only after user-message
persistence succeeds. A persistence failure therefore leaves the arm available
for the next accepted send instead of creating a stranded capture. In
supervisor-enabled groups, the same capture remains active while the supervisor
is debounced and is finalized only after the deferred supervisor path finishes.
If another accepted group message replaces that debounce timer, ownership of
the capture transfers to the replacement timer instead of completing an empty
batch. The capture ID also follows tool execution into each continuation
request.

A request is `complete` only after its provider-ready payload is captured. A
provider rejection or streamed failure marks that request `error`; eager
rejections include a sanitized prepared payload in the non-success response
when preparation already occurred. A batch is `complete` only when every
request completed with a provider payload. User cancellation, an empty
execution, an aborted dispatch before provider preparation, an incomplete
continuation, or any request error produces a viewable `partial` batch. Late
snapshots for cancelled or finalized captures are ignored. The drawer can
cancel an active capture, copy either selected layer, or download the complete
sanitized batch as JSON.

Snapshots are held only in transient Zustand state. They are not persisted to
messages, topics, the database, local storage, logs, or traces. Sanitization
removes credentials, authorization and base URL data, request options,
callbacks/signals, provider request user identifiers and metadata, trace/cache
routing fields, data URLs, and provider-native inline media payloads such as
`inlineData.data`, `inline_data.data`, `source.data`, and `inputAudio.data`
before the UI receives the snapshot. Ordinary tool argument fields named
`data` remain available. JSON Schema name maps such as `properties`,
`patternProperties`, `$defs`, and `definitions` retain their entry names
because those names define the tool contract; schema values are still
recursively sanitized. Snapshot metadata reports the user-selected provider ID
separately from the resolved runtime adapter, so a custom OpenAI-compatible
provider remains identifiable while its runtime is shown as `openai`.

A notable implementation detail in the current code is proxy image URL resolution. After MCP tool calls, refreshed messages may contain `/webapi/files/...` URLs that are not directly accessible to providers, so `contextEngineering` attempts to resolve them back to public URLs before the pipeline runs. Resolution is best-effort per image: an unowned, deleted, or otherwise unresolvable reference keeps its original proxy URL and does not fail the whole send. The provider may still reject or be unable to fetch that individual URL.

## Topic compaction and watermarks

Topic compaction is incremental. Raw messages remain in storage; the topic metadata field
`historySummaryLastMessageId` records the last complete turn represented by `historySummary`.
Request construction removes messages through that cursor before applying the configured history
window. The token estimator, token popover, and provider request all use the same latest-user-anchored
window from `packages/context-engine`, so assistant/tool continuations extend the active turn without
sliding the cached prefix. A pathological continuation tail is bounded separately: the default keeps
the newest 20 assistant/tool messages after the latest user message, preserving the current tool
results instead of the oldest tail entries.

The configurable compact threshold is the high watermark. It is clamped to 50%-99% and defaults to
80%. The low watermark is derived 20 percentage points below it, so the default target is 60%.
Token compaction chooses the oldest complete turns needed to reach the low watermark. It never
summarizes the latest user turn or an unresolved assistant/tool tail. If fixed prompt content and the
protected turn already exceed the target, the action reports `target_unreachable` instead of retrying
the same unchanged context continuously.

The compaction prompt merges only messages after the cursor into the prior summary and caps the model
output at 400 tokens. Large deltas are split between complete turns into bounded batches. A pre-send
token-threshold run processes at most three batches so sending remains bounded; it persists a cursor
only through the batches actually summarized, and a later run resumes from that cursor. Manual,
scheduled, and message-count runs may process all eligible batches. Legacy topic summaries without a
valid cursor are rebuilt from raw eligible history once, rather than treating an unknown prefix as
safely compacted. Empty or failed model output never replaces the existing summary or advances the
cursor. Identical archive excerpts are not stored twice.

All entry points use the same per-topic single-flight action: manual, message-count, daily, pre-request
token checks, and reactive token automation. The automatic watcher is driven by message/config/token
changes instead of a polling timer. Topic compaction and topic-summary injection are intentionally
limited to regular topic chats. Group chats and active/portal threads use their raw scoped history and
cannot create, mutate, or consume a regular topic summary; assistant-wide memory remains available.

The daily browser marker is scoped by canonical account, session, and topic. An unresolved account
does not write a marker, so a topic is not accidentally suppressed for another signed-in account.

## Two-tier assistant memory

Each agent carries two memory tiers on the `agents` row. `fixed_memory` is a user-curated
markdown document: always injected when non-empty, never rewritten by automation
(it is passed to the rollup prompt only as do-not-duplicate context). `assistant_memory` is the
dynamic tier: a small durable-facts document the rollup maintains, with its bookkeeping in the
`assistant_memory_meta` jsonb (per-topic watermarks, a one-slot previous-version backup, and
last-error/backoff state). Both tiers are injected by `AgentMemoryProvider` inside an
`<assistant_memory>` wrapper right after the agent system role — durable memory no longer ships
inside the `<chat_history_summary>` framing, and `HistorySummaryProvider` now carries only the
topic-scoped summary. The token popover and async estimator report the memory block as its own
allocation bucket, and member/agent-scoped requests inject the target agent's own memory and chat
config rather than the host session's.

The whole feature is gated per assistant by `chatConfig.enableAssistantMemory` (default on):
when off, nothing is injected, estimators count zero, the scheduler and manual rollup skip
(`disabled`), the save-memory tool is not offered, and the Memory tab collapses to the master
switch. Stateless assistants opt out with one toggle.

The model can also maintain fixed memory through an implicit builtin tool (`lobe-memory`,
hidden from the plugin picker) with full CRUD: `saveMemory` appends, `updateMemory` rewrites
one entry, `deleteMemory` removes one. Request inclusion is explicit:
`createChatToolsEngine` takes an `enableMemoryTool` option threaded from
`internal_fetchAIChatMessage` — enabled only for the active agent's own sends (never
group/member requests, whose ambient write target would be the wrong agent) — and both token
estimators pass the same flag so schema-token estimates stay in lockstep; the option keeps
ambient store reads out of `toolEngineering`, avoiding an import cycle.

Entries are numbered `#N: …` lines and the numbering is kept dense: the fixed-memory editor
renumbers on every user save and `deleteMemory` renumbers the remainder, so deleting `#2`
makes `#3` become `#2`. Because numbers are injected at turn start and can shift underneath a
running turn, update/delete are content-verified: each call carries the index plus a `match`
snippet; on `not_found`/`mismatch` the tool refuses the write and returns the current numbered
entry list as the tool result so the model self-corrects within the same turn. All three
writes serialize through one promise chain (tool calls in a turn run concurrently) and use the
id-targeted `internal_updateAgentConfig` rather than the abortable shared-slot path. Only
`#N:` lines are ever renumbered — free-form markdown in the doc is preserved verbatim.

The rollup is a selective extractor, not a consolidator. The prompt admits an item only if it
would change behavior in a future unrelated conversation, requires category-organized output
(never per-topic digests), and allows an exact `NO_CHANGES` sentinel reply; a sentinel run
advances watermarks without rewriting the document. Dirtiness is a hash of each topic's
compaction summary text: unchanged topics are never re-fed to the model, and a fully clean pass
costs zero LLM calls. Manual "regenerate" passes `force` for a full rebuild. Output is bounded
twice — `max_tokens` on the request and a token-based post-cap (CJK-safe, replacing the old
char-only cap) — and multilingual preamble stripping guards the stored text. A refusal, error, or
empty output never overwrites the document; it records `lastError`, whose attempt count drives an
exponential backoff (10 min base, 6 h cap) honored by scheduled runs. Successful runs keep the
prior document in the one-slot backup, and `restoreAssistantMemoryBackup` swaps it with the
current text so restoring twice is a redo.

Rollup runs are single-flight per account scope and agent; the scheduler and the manual button
join the same in-flight job. Rollup currency is ACCOUNT-level only: the target session/agent is
captured at start, so the user can navigate to other sessions while the rollup runs in the
background and the result is still written to the captured agent — only an account switch or
scope reset aborts. In-flight agent ids are exposed in store state
(`assistantMemoryRollingAgentIds`) so the Regenerate spinner survives unmounts and navigation.
The rollup day-marker is account-scoped
(`lobe_assistant_memory_rollup_<scope>_<agentId>`) on the local calendar day, written on success
and on genuine no-op skips but not on failures or backoff skips, and the scheduler interval reads
all state inside its tick so switching agents never resets it. The legacy Dexie edition cannot
list topics for the rollup, so scheduler, action, and UI buttons are gated off there while fixed
memory continues to work. After a successful write, every agent-config SWR key in the account
scope is revalidated so sibling sessions bound to the same agent drop their stale copy.

Assistant-wide memory rollup is an agent-store action, while `ChatService` reads the agent store when
assembling requests. The action therefore lazy-loads `@/services/chat` only when a rollup runs; a
static import would create an agent-store initialization cycle in the Next.js server bundle. Because
module loading is asynchronous, the action revalidates its captured account and agent context before
calling the service.

The memory-archive snippets attached to a topic are prefixes of successive versions of the same
cumulative summary, so injection drops any excerpt already contained in the current summary text or
in a newer kept excerpt instead of repeating it.

The settings Memory tab edits both tiers through the scoped AgentSetting store, so the defaults
page and group-member drawers target the agent they display; rollup and restore act on the active
session's agent and are disabled elsewhere. The topic compaction summary is topic-scoped and
therefore lives outside assistant settings: a shared `TopicSummaryViewer` drawer (markdown +
model tag + copy/export) opens from the token-badge popover for the active topic and from each
topic's dropdown menu for any topic with a summary.

Memory UI actions do not gate their visible state on the write promise: config writes share an
abort-controller slot that a newer write may abort after the server already committed, so the
promise alone cannot distinguish "failed" from "superseded post-commit". Actions apply local state
optimistically, report success/failure via toast, and on failure refetch the agent config to
converge on the database truth. `updateAgentConfig` releases the shared abort slot when its request
settles, so completed requests can no longer be aborted retroactively; aborting a genuinely
in-flight previous write (rapid slider edits) is preserved. The scoped store's `onConfigChange` may
return a promise and is awaited, so write failures propagate to the settings UI on every surface.

Compaction persists the summary, cursor, archive data, and bounded debug log in one topic update. The
debug entry records trigger, result, watermarks, before/after estimates, and cursor. Pre-send work
checks its abort signal after every awaited phase and immediately before persistence. If Stop races a
completed topic write, compaction restores the prior summary and metadata; if message invalidation
races the write, the cleared invalidation state takes precedence. Editing, deleting, or
retry-rewinding a message at or before the cursor invalidates the derived summary and archive state
before the conversation is regenerated.

Server-mode V2 sends persist the user message and reserve the assistant ID first, but they do not
create the assistant placeholder until the pre-send compaction attempt settles without cancellation
and the conversation is still current. Placeholder creation is a
separate authenticated, idempotent mutation that verifies the parent user message and the exact
session/topic/thread scope. Stop remains wired to the pre-send controller through this mutation, and
account or conversation changes prevent placeholder creation and model dispatch. Portal-thread Stop
passes `portalThreadId`, so it cannot abort a main-chat pre-send compaction that shares the same topic.

## Retry and conversation rewind

Retry is a state transition, not an append-only resend. The selected message resolves to its
owning user-message anchor (or the nearest preceding user message). ChatHub then removes every
active-branch message after that anchor—including error diagnostics, tool chains, and later user
turns—before requesting a replacement answer. Threads whose source lies in the discarded tail,
plus their descendants, are removed in the same database transaction so no orphaned subtopics
remain.

The UI applies the rewind optimistically, clears generation/reasoning/RAG/search/tool state, and
cancels active producers. Generation starts only after persistence succeeds. A persistence failure
restores and refreshes conversation state without generating; additional retry clicks are ignored
while a rewind is in progress. Main-chat, active-thread, portal-thread, and group-chat retry
buttons all use this primitive. Group retry routes the retained user message through the existing
supervisor/direct-mention flow and does not create a second user message.

If the discarded tail intersects the topic compaction cursor, retry also clears the derived topic
summary and its archive excerpts. A later compaction rebuilds them from the retained raw messages.

## Package boundary

`packages/context-engine` holds the reusable pipeline and processors. It is shared logic rather than app-only code, which is why placeholder handling and message cleanup changes often show up there first.

## Change guidance

When editing context shaping, review both the pipeline order and the processor tests. Small changes in ordering can change the final model input in ways that are hard to spot from the UI.

Useful test locations include:

- `packages/context-engine/src/processors/__tests__/MessageContent.test.ts`
- `packages/context-engine/src/processors/__tests__/PlaceholderVariables.test.ts`
- `packages/context-engine/src/providers/__tests__/AgentMemoryProvider.test.ts`
- `src/services/chat/contextEngineering.test.ts`
- `src/store/agent/slices/chat/action.test.ts` (rollup watermarks/backoff/undo)
- `src/features/Conversation/components/ContextMemory/AssistantMemoryRollupScheduler.test.tsx`

## Key source references

- `src/services/chat/contextEngineering.ts`
- `src/helpers/contextCompaction.ts`
- `src/store/chat/slices/aiChat/actions/memory.ts`
- `packages/context-engine/src/pipeline.ts`
- `packages/context-engine/src/processors/`
- `packages/context-engine/src/providers/`
