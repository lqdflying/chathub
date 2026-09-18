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
edits, dynamic memory when a dream or manual rollup writes), ahead of the more volatile inbox/tool/summary
blocks, which preserves provider prompt-cache hit rates.

The chat-input token popover **Most recent reported cache** figure is not that live tokenizer estimate. It reads cache fields from the latest assistant or grouped tool-turn `usage` / `metadata` / children (`src/features/ChatInput/ActionBar/Token/getPromptCacheHitRate.ts`) and divides cached tokens by `totalInputTokens` when present. Durable Graphile turns must persist `ModelUsage` **flat** on `messages.metadata` (matching browser `generateAIChat` `onFinish`). Nested `{ usage: ModelUsage }` from older workers is unwrapped on read. The visible status line is rate · status · cached/input; the reporting model stays on the help icon so the popover stays narrow. In-flight `LOADING_FLAT` rows are skipped; a later completed reply that only has totals keeps a previous cache-bearing rate, or shows `0 / totalInput` with status `provider reported` when no cache counters exist in the topic. The rate definition does not change when Anthropic omits a zero write counter.

The **next request estimate** (`estimateContextUsageAsync` / `useEstimatedContextUsage`) floors `totalToken` with that same latest settled `totalInputTokens` when the provider billed more than ChatHub's tokenizer (`tokenx` approximation above 10k chars, plus `CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 2` for window math). The gap is added to `chatsToken` so the popover still adds up. After compaction, only assistants **after** `reportedInputTokenFloorAfterMessageId` are eligible as a floor: that id is the newest remaining assistant/group at compact time (or the protected user when no assistant exists yet), including an in-flight placeholder. The protected turn still sits after the cursor, but its pre-compaction `totalInputTokens` included the now-summarized prefix. Editing that row does not revive it. Estimators resolve the stored id against the **full** topic order, then intersect with the HistoryTruncate window: a marker older than the selected slice still floors later selected reports; a marker absent from the topic fail-closes (no floor) instead of treating older usage as fresh. Compacted topics that predate the field persist a one-time migration boundary from the remaining post-cursor window on message fetch, compact, or watermark-row delete — ordinary estimates do not recompute that boundary from the current slice, which would treat a genuinely new reply as already-seen. Deleting the watermark row rotates it to the newest remaining post-cursor message, or to the compaction cursor when none remain, so a later completed reply can floor again. Watermark migration re-reads **main-topic** `threadId IS NULL` rows (no page cap) and merges that single field under the same conversation write lock as durable compaction. The client applies the returned watermark only when the local cursor, summary, **and request-start watermark** still match, so a delayed HTTP response cannot replace a newer same-generation marker. Inline and durable persist send a fixed-length SHA-256 digest of a JSON fingerprint (`[cursor, summary, [id, role, content]…]`), not raw conversation text. After locking candidates they re-read the topic revision and reject if the summary or cursor changed, so a disjoint prefix edit/delete cannot be overwritten by a stale incremental rollup. Transcript-shaping server message updates (`content` or `role`), deletes, and rewinds share that conversation write lock, lock the mutated rows, and clear an authoritative prefix summary when the id is at or before the cursor. Metadata-only updates stay off that path. Cache telemetry stays independent of this next-request floor.

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
instructions into unrelated turns. Activation is derived from the latest user
turn only. Loader tool results persist a compact activation marker, while the
full body is re-resolved for that continuation and omitted from stored history.
See [Agent Skills](../integrations/skills.md) for the storage, source validation,
and activation contract.

## Context allocation and export

The token popover separates `Chat Instruction`, `Role Settings`, plugin settings,
history summary, group orchestration, supervisor input, and chat messages. The
displayed total preserves the separator cost used by the composed prompt. Group
estimates use a representative member prompt and do not count the same response
instruction as both orchestration and chat history. Portal and thread estimates
use their own raw conversation source with the current history-count settings,
so their allocation does not reuse the main-chat message history or become
stale when the history limit changes.

When chat RAG actually retrieves Knowledge Base chunks, the regular popover adds
an active-only `Knowledge Base` bucket. It counts the complete generated
`<knowledge_base_qa_info>` block, including its instructions, metadata, tags,
and selected chunks. No retrieval runs merely to estimate this value. The
bucket is present while the initial provider request carries the block, then is
cleared before any tool continuation. The injected block is built on a cloned
message list and is not consolidated into stored chat history, although it does
consume the provider context window for that request. Group estimates remain
unchanged because the group orchestration path does not inject chat RAG.

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

For a captured RAG request, the allocation includes the active Knowledge Base
tokens and the request has a bounded structured summary: whether the query was
rewritten, direct/expanded scope counts, cosine candidate/threshold/result
counts, selected scores, and an optional diagnostic ID. The raw injected block
already appears in the sanitized Engineered Context, so the summary does not
duplicate chunk text or private database identifiers. A RAG preparation error
creates a viewable partial capture with the diagnostic ID when diagnostics are
enabled. Tool continuations use the original allocation and do not retain the
Knowledge Base bucket.

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
Request construction removes messages through that cursor before applying the **effective** history
window. `resolveEffectiveHistoryWindow` (`src/helpers/contextCompaction.ts`) keeps the configured
`historyCount` on small cards; when `contextWindowTokens >= 128k`, it expands (or temporarily
disables) message truncate while an approximate chat payload still fits under 55% of the window
after fixed overhead. The token estimator, token popover, browser `createAssistantMessage`, and
Graphile `payload.ts` all share `estimateFixedContextOverheadTokens` (system role, assistant
memory, wrapped history summary, tool schemas/roles, and `formatSkillInstructionsBlock` XML)
plus latest-user-anchored slicing from `packages/context-engine`. Input templates are **not** a
one-shot overhead string: `resolveEffectiveHistoryWindow` / `serializeMessagesForContextEstimate`
apply the same `{{text}}` expansion as `InputTemplateProcessor` to every included user row.
The popover adds in-flight Knowledge Base tokens on top of that same overhead.
`configuredHistoryCount` is the persisted HistoryTruncate setting shown as **History limit**
in the token popover. `effectiveHistoryCount` is the runtime cap used for slicing: the configured
value when truncate is active, or the full post-cursor topic length when large-window expansion
temporarily disables truncate. The popover appends **Large-context expanded to N** only when
`effectiveHistoryCount` exceeds `configuredHistoryCount`. `includedMessageCount` is the sliced row
count after assistant/tool continuations. Assistant/tool
continuations extend the active turn without sliding the cached prefix. A pathological
continuation tail is bounded separately: the default keeps the newest
20 assistant/tool messages after the latest user message.

The token popover title is a **next request estimate**. It also exposes a History window block
(included/topic counts, exclusions, the configured history limit with an optional large-context
expansion suffix, topic-wide chat estimate, last `memoryDebugLog` status) and
counts history summary text with the same `<chat_history_summary>` wrapper the request injects.
Chat message estimates serialize `role` + `content` + tool payloads rather than content-only joins.
The unsent editor draft is treated as the next user row for window selection and is counted once
after the same `{{text}}` input template the request applies. File-only pending sends add the same
empty user row the request will create so prefix/suffix templates are not omitted. History-window
**included/topic** counts in the popover exclude that synthetic draft row; they describe persisted
topic messages only, while window math still includes the draft.

The configurable compact threshold is the high watermark. It is clamped to 50%-99% and defaults to
80%. The low watermark is derived 20 percentage points below it, so the default target is 60%.
The 80% gate lives only on `trigger=token_threshold`. It compares
`estimateContextUsageAsync` (system role + tools + assistant memory + wrapped history summary +
activated skill XML + `selectMessagesForContext` with per-user input templates + input) to `enabledAiModels[].contextWindowTokens` for the
**active chat model** (including user overrides; OpenAI-compatible cards are forced to 258k).
It does not compare full-topic size to the vendor's advertised window. `message_count`,
`scheduled`, and `manual` ignore that gate. The token-badge watcher ratio can include
in-flight Knowledge Base tokens that the planner estimate does not. Operators diagnose
those mismatches with `CHATHUB_COMPACTION_DEBUG` (`chathub-compaction-debug`); that switch
does not change watermarks or when compact runs. `planner_settled` may also include
`effectiveHistoryCount` (the window setting, not the included-row count),
`excludedByHistoryCount`, and `preSendMessageCountCompact`.

The estimate is **usage-anchored**: when the newest post-watermark assistant message carries
provider-reported `totalInputTokens`, that value already covers fixed overhead plus every message
up to its request, so `estimateContextUsageAsync` and the token popover tokenize only the tail
(the anchor's own reply and later rows, including the pending draft) and add it to the reported
number instead of tokenizing the whole window — the whole-window tokenizer undercounted a
CJK-heavy History Compress prompt by roughly 3x. Without a usable anchor the estimator falls back
to the whole-window estimate floored by the latest reported input
(`applyReportedInputTokenFloor`), exactly as before. The anchor lookup
(`getLatestReportedInputAnchor` in `src/helpers/reportedContextTokens.ts`) reuses the
`reportedInputTokenFloorAfterMessageId` watermark, so a pre-compaction report can never anchor a
post-compaction estimate. The anchor is only trusted against a **verified request baseline**
(`resolveAnchorBaseline`, a bounded in-process map keyed by anchor message id): the baseline
records the fixed-overhead tokens, a cheap prefix fingerprint (pre-anchor message count,
content chars, newest `updatedAt`), the **selected pre-anchor row ids** the request
actually included, and the **input template** applied to those user rows. Both callers — the async estimator and the token popover hook — share
that one map, so both record overhead with the SAME sync measure
(`estimateFixedContextOverheadTokens`, chars/2 via `CONTEXT_CHARS_PER_TOKEN_ESTIMATE`); the
estimator's tokenized fixed count feeds only its own final math and is never registered,
otherwise a UI mount would shift the send estimate by the unit gap. Later estimates add the
fixed-overhead delta (skill/instruction/memory/tool changes) in those shared units.

A baseline is never registered on first sight of a report. Witnesses are recorded **only by
the send path**. Durable enqueue **captures** overhead, history-window, and input-template
inputs from the config about to be sent (`captureAnchorDispatchEvidence`) **before** `await` enqueue/send,
then **commits** that evidence onto the returned assistant id
(`commitAnchorDispatchWitness`). Re-reading live agent settings after the RPC would certify
instructions the worker never sent. Browser retry/continuation still records at request
assembly (`recordAnchorDispatchWitness`), when live settings *are* the request. Estimators
never write witnesses, so viewing another topic, changing skills mid-generation, or a
reload into an already-running request cannot invent dispatch proof from estimate ordering.
A report is trusted only when a witness exists for **this assistant row in this
conversation** whose parent id and full-prefix fingerprint still match exactly; the witness
is then **promoted** to a verified baseline (consumed, one-shot). Otherwise the estimator
falls back to a fresh whole-window estimate (floored by the report). After a reload, new
tab, navigation into a request this tab did not dispatch, or baseline eviction, the module
has no witness, so stale reports are never trusted: a prompt whose pre-reload local estimate
was over 11,000 tokens is estimated in full again (the old contract showed 1,013 — a
1,000-token report plus a 13-token tail). A full-prefix mismatch (pre-anchor edit or delete)
invalidates the anchor **until a fresh provider report arrives under a new
anchor id**. A history-window **expansion** (raising or disabling the limit, including from an
enabled count of **zero**, or an automatic effective-window expand that newly
includes older rows) also invalidates: the report never counted those rows, so
the estimator falls back rather than adding only the post-anchor tail. A
zero-limit dispatch records an **empty** selection — `slice(-0)` would have
certified the entire prefix. Sliding the window so older rows **drop out**
keeps the anchor — those tokens are no longer sent, and keeping the report is a
safe overcount. Changing `chatConfig.inputTemplate` after the request also
invalidates (the original report counted that template on every included user
row; the tail-only serialize would omit added text on pre-anchor history). The
mismatched baseline is never re-registered.

Request assembly also applies a **deterministic tool-result cap**:
`ToolResultTruncateProcessor` (`packages/context-engine`) rewrites any `tool` message body over
8,000 chars to a fixed prefix plus a `…[truncated N chars]` marker. The cap is a pure function of
the message content — never of position or time — so capped bytes are stable per message id and
the prompt-cache prefix survives across turns; stored messages keep full content and
tool-call/tool-result pairs are never split. Both the browser (`contextEngineering.ts`) and
worker (`payload.ts`) pipelines run it right after `HistoryTruncateProcessor`, and the estimate
serializers apply the same cap by default so planner and popover numbers match the wire (the
popover's topic-wide growth signal opts out). In the `token_threshold` planner the high-watermark
gate still evaluates the **untruncated** total (estimate plus the chars/2 recovery estimate from
`estimateToolResultTruncationRecoveryTokens`, logged as `truncationRecoveryTokens`), preserving
trigger semantics; when truncation alone brings the wire estimate to or below the low watermark
the run settles as `not_needed` / `truncation_sufficient` and no summarizer call is made.
Otherwise compaction proceeds as before, with prefix selection also measured in capped (wire)
terms.
Token compaction chooses the oldest complete turns needed to reach the low watermark. It never
summarizes the latest user turn or an unresolved assistant/tool tail. If fixed prompt content and the
protected turn already exceed the target, the action reports `target_unreachable` instead of retrying
the same unchanged fingerprint. The auto-compact watcher re-arms `failed` jobs after backoff (a
retired idempotency key can start a new Graphile job) but keeps `target_unreachable` latched until
messages, cursor, summary, model, or the token estimate change.

The compaction prompt merges only messages after the cursor into the prior summary. Output caps scale
with Assist preset (minimal 400 / balanced 600 / rich 800 tokens) via
`getContextCompactionMaxSummaryTokens` and are embedded in `chainSummaryHistory` as well as the
API completion budget. Large deltas are split between complete turns into bounded
batches, then **again by estimated summarizer prompt size** against the History Compress model's
`contextWindowTokens` (`deepseek-flash` is 1,048,576). Saved
History Compress ids `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` reuse
that native Flash card for window sizing and thinking-off sampling; they stay off
the picker. Message-count batches of 40 can still
overflow that window when early turns hold huge tool/code payloads; the worker sizes each
`chainSummaryHistory` prompt at 1 char ≈ 1 token and keeps about 45% of the summarizer window for
input. Token-aware splits stay on **complete-turn** boundaries (never a user row without its
assistant/tool tail). If the first complete turn itself exceeds that budget, the worker/client
**soft-stubs** it: a bounded placeholder is folded into the running summary (no message bodies)
and the cursor advances past that turn so later batches can still compact. If many stubs would
exceed 12,000 characters, the fallback keeps the **newest** tail of the running summary plus the
new stub (not the oldest prefix). A budget-legal batch
that still returns a provider context-length `ProviderBizError` (`maximum context length is …`)
or an empty summary fails once (not Graphile-retried). Durable jobs carry the planner's resolved
`summarizerContextWindow` (including custom/unlisted cards); the worker uses that snapshot before
the built-in model-bank / 128k fallback.

Every summarizer completion also runs under a hard deadline:
`createCompactionSummarizerTimeoutSignal` (`src/helpers/isContextOverflowError.ts`) combines the
caller's abort signal with `AbortSignal.timeout` (default 120s; server
`CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS`, browser
`NEXT_PUBLIC_CONTEXT_COMPACTION_SUMMARIZER_TIMEOUT_MS`). A timed-out batch maps to
`CompactionSummarizerTimeoutError`, which fails the compaction once — like
`EmptyCompactionSummaryError` it is never Graphile-retried — in both the browser planner
(`summarizeBatch`) and the durable worker (`runCompactionPlan`).

**Failed compaction idempotency:** a terminal `failed` / `interrupted` / `cancelled`
`memory_compaction` row must not stick the topic. Enqueue retires that idempotency key and
creates a new Graphile job; `succeeded` / in-flight keys still replay. The planner treats a
returned terminal failure as `failed` (not `durable_enqueued`). The auto-compact watcher
re-arms after a `failed` attempt, not after a stable `target_unreachable`.

**Pre-send send gate:** after `token_threshold` compact, if the outcome is `failed` or
`target_unreachable` and **post-compaction** usage is still at/above the high watermark, Send does
**not** enqueue chat. `target_unreachable` that drops usage into the band between low and high still
sends. It persists the user message plus an assistant `ExceededContextWindow` error bubble and
re-arms compact. Browser empty-at-ceiling completions also trigger another compact attempt.

**Overflow self-healing:** when a provider still rejects the request (or returns an empty
completion at the context ceiling) despite the gates above, the shared classifier
`isContextOverflowError` (`src/helpers/isContextOverflowError.ts`) recognizes
`AgentRuntimeErrorType.ExceededContextWindow`, the empty-completion-at-ceiling shape, and
provider overflow signatures (`context_length_exceeded`, `maximum context length`,
`prompt is too long`, MiniMax `2013`, and similar message/body patterns). Both lanes then force
one compaction and re-dispatch the send **once** per send. This emergency recovery deliberately
overrides the History Count / History Compress switches in both lanes (D1): those switches govern
routine scheduled/manual compaction, not rescuing a send the provider already rejected — the
browser lanes pass `allowWhenCompactionDisabled` to the manual compaction action, and the worker
lane never consulted the switches. The browser lanes
(`internal_coreProcessMessage`, V2 `internal_execAgentRuntime`) run the manual compaction action
with a dedicated abort controller (forcing the inline, batch-capped path even when durable
generation is on), remove the failed assistant row (V1) or clear its error (V2), and retry with
`contextOverflowRetried` set — and request assembly treats that flag as part of the emergency
override, applying the just-persisted summary/cursor even when the routine switches are off
(without it the one allowed retry would resend the unshortened history and overflow again; the
user's routine settings are left untouched). The durable worker (`execute.ts`
`attemptContextOverflowRecovery`) runs `runCompactionPlan` inline with the configured **History
Compress** model/provider (`loadHistoryCompressModel`, the same selection the dream job and the
browser compaction lane use — never the chat model) **and that model's effective
`summarizerContextWindow` resolved from the runtime model card** (custom/unlisted cards
included, exactly like the planned-compaction snapshot — the static model-bank / 128k fallback
applies only when the card carries no window), and retries the generation step
with the same `conversationContext`, stamping `contextOverflowRetried` into the persisted config
snapshot **before** compacting so a retried operation cannot loop. The recovery rebuilds the
payload from the **current persisted transcript** (`loadScopedMessages` plus a fresh agent-row
read), mirroring the tool-continuation reload — never from the pre-send `workingMessages`
snapshot — so tool results and memory writes produced by the failed attempt survive the retry
and a completed mutation cannot be repeated. Retrieval augmentation is the one deliberate
exception to "fresh rows only": `injectRag` output is in-memory only (never persisted), so the
executor snapshots the current turn's RAG overlay (message id plus base/augmented content) and
reapplies it onto the reloaded rows in **both** the overflow-recovery rebuild and the
tool-continuation reload — guarded by an unchanged base content, so a mid-flight edit never
resurrects stale retrieved text, and the retried/continued request keeps the knowledge the
first model call was billed for. When compaction cannot reclaim
history, the original `ExceededContextWindow` error bubble is kept.

Durable enqueue returns status `enqueued` (not `ineligible`) so Compact now does not toast
“this conversation cannot compact”. **Any** abortable pre-send run (`message_count` or `token_threshold`) processes at most
three batches; it persists a cursor only through the batches actually summarized, and a later run
resumes from that cursor. Server-mode send runs client pre-send `message_count` then
`token_threshold` **before durable enqueue** (and again on the browser-fallback path after the
user message is committed) so settled overflow is summarized before `HistoryTruncate` can drop it.
When auto-create-topic fires, the client creates the topic, relocates default-conversation rows,
and runs that same pre-send compaction **against the created topic id** (not whichever topic is
active in the UI), then enqueues with the topic id (no `newTopic` payload). A force-title marker
replaces the placeholder Default Topic after send. If `createTopic` fails before an id exists, the
editor snapshot captured before `useSend` clears the input is restored and the send error is
shown; if creation already committed, the send continues against that topic. Account and
conversation-clear fences are re-checked after compaction; navigation alone still
allows durable enqueue. Post-send `message_count` remains as catch-up. Non-abortable manual / scheduled / post-send
message-count runs may process all eligible batches. Legacy topic summaries without a valid cursor
are rebuilt from raw eligible history once. Empty or failed model output never replaces the existing
summary or advances the cursor. Identical archive excerpts are not stored twice.

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
dynamic tier: a numbered, date-tagged card document the dream **appends** to (one card per
successful scheduled run), with its bookkeeping in the
`assistant_memory_meta` jsonb (per-topic watermarks, a one-slot previous-version backup, and
last-error/backoff state). Both tiers are injected by `AgentMemoryProvider` inside an
`<assistant_memory>` wrapper right after the agent system role — durable memory no longer ships
inside the `<chat_history_summary>` framing, and `HistorySummaryProvider` now carries only the
topic-scoped summary. Injection is budgeted (`AGENT_MEMORY_INJECTION_MAX_CHARS`, default 24k
chars of the formatted block): a doc that fits is injected whole and byte-stable; a larger doc
is cut at a line boundary to a deterministic head portion plus a one-line pointer telling the
model to use the `searchMemory`/`readMemory` recall tools (`applyAgentMemoryBudget`, a pure
function of the doc, so prefix stability holds per doc state). The token popover and async estimator report the memory block as its own
allocation bucket, and member/agent-scoped requests inject the target agent's own memory and chat
config rather than the host session's.

Memory entries also carry **provenance** (M2, OpenClaw-style injection guard). Origins live in
`assistant_memory_meta.entryOrigins` — a jsonb map from `hashText(entry content)` to
`owner` (settings editor), `dream` (dream cards), `agent` (memory-tool write), or `untrusted`
(memory-tool write whose recent turn history contained external MCP/web tool output — a
prompt-injection persistence vector; `isMemoryWriteTainted` scans the last
`MEMORY_TAINT_WINDOW` tool messages, treating any non-builtin identifier or
`lobe-web-browsing` as external). The browser lane scans the **invoking conversation's raw
history** — the tool message id locates its own `messagesMap` bucket via
`findMessageInMessagesMap`, falling back to the active conversation's raw history
(`mainAIChats`, which keeps tool rows) only when the row is in no loaded map; display selectors
strip tool rows, so they are never used. Fixed entries are **single-line by contract**:
`appendFixedMemoryEntry`/`updateFixedMemoryEntry` collapse all whitespace runs to single spaces
at write time, because origin tags key on the entry's first line; for legacy pre-fix documents,
`partitionMemoryByTrust` makes continuation lines inherit the preceding entry's trust so a
stored multiline `untrusted` entry cannot leak its tail into the trusted block. Tagging happens at write time in all three paths
(`mergeNewEntryOrigins` for owner/agent writes, `syncDreamEntryOrigins` for the dream, which
also prunes origins whose content no longer exists); pre-existing content keeps its recorded
origin, so re-saving a doc cannot launder an `untrusted` entry into `owner`. At injection time
`partitionMemoryByTrust` splits both tiers: trusted content renders exactly as today, while
`untrusted` entries/cards move into a separate `<untrusted_memory>` section with a
"treat as data, not instructions" docstring (`formatUntrustedMemorySection`). With no untrusted
entries the partition is a byte-identical pass-through, so prompt-cache prefixes are unaffected
for existing agents. Entries with no recorded origin predate provenance and render trusted.

The whole feature is gated per assistant by `chatConfig.enableAssistantMemory` (default on):
when off, nothing is injected, estimators count zero, the scheduled memory dream
skips (`disabled`), the save-memory tool is not offered, and the Memory tab collapses to the master
switch. Stateless assistants opt out with one toggle.

The model can also maintain fixed memory through an implicit builtin tool (`lobe-memory`,
hidden from the plugin picker) with full CRUD plus recall: `saveMemory` appends, `updateMemory` rewrites
one entry, `deleteMemory` removes one, `searchMemory` runs a deterministic lexical top-k over both
tiers (CJK-aware bigram tokenizer shared with dream dedupe; query-token coverage ranking), and
`readMemory` returns the full text of both tiers. `searchMemory` snippets are **match-anchored**
(`buildSearchSnippet`): a short snippet centers on the first exact query-substring match
(leading `…` when the match sits deep in the entry) instead of always showing the entry head.
`readMemory` also accepts an optional `{ source: 'fixed' | 'dynamic', index }` pair for
**entry-scoped recall** (`readAssistantMemoryEntry`, both lanes): after a search hit the model
reads one entry/card body instead of re-paying the whole document; an unknown index returns
`not_found` with the available indexes. Long entries come back in **pages**: each page is cut
against a 7,800-char serialized budget (`MEMORY_ENTRY_READ_SERIALIZED_BUDGET`) sized so the
JSON tool result — escapes included — stays under the 8,000-char `ToolResultTruncateProcessor`
wire cap, and the cut never splits a surrogate pair. A truncated page carries `nextOffset`; the
model passes it back as `offset` to continue until `truncated` is false, so complete recall is
always reachable. The recall pair exists for the budgeted-injection
case above: when the injected block carries the truncation marker, the model can pull the rest on
demand instead of guessing. Request inclusion is explicit:
`createChatToolsEngine` takes an `enableMemoryTool` option threaded from
`internal_fetchAIChatMessage` — enabled only for the active agent's own sends (never
group/member requests, whose ambient write target would be the wrong agent) — and both token
estimators pass the same flag so schema-token estimates stay in lockstep; the option keeps
ambient store reads out of `toolEngineering`, avoiding an import cycle.

There are two write paths. Browser-fallback builtin execution still uses the id-targeted
`internal_updateAgentConfig` (not the abortable shared-slot path). Durable Graphile
generation runs the same helpers inside `invokeMemoryTool` and writes `agents.fixed_memory`
directly. That path never goes through the client updater, so after a successful tool result
lands in `useFetchMessages` the client revalidates `FETCH_AGENT_CONFIG` for the session and
every sibling key in the account (the same sibling-key idea as the dream). Opening Assistant
settings also refetches so the Fixed memory list does not wait on the 5-minute SWR focus
throttle. Settings persist patches only — a stale full snapshot must not overwrite a newer
server document. Client `updateAgentConfig` and `internal_updateAgentConfig`
serialize those writes per account scope and session. Public
`updateAgentConfig` writes each own an `AbortController` (account reset aborts
every owned public controller). Id-targeted `internal_updateAgentConfig` jobs
are fenced by account/ownership generation instead of that controller list. A
later save in another session must not abort a public write, and queued jobs
re-check account/ownership generation before optimistic `agentMap` updates or
RPC so a previous account's patch cannot land after switch. Global
`togglePlugin` records the latest intended plugin list as pending intent owned
by a write token plus account/store generation, publishes it immediately, and
persists only that field. Each queued persist mints its own token even when
the plugin list is unchanged, so a failed older write cannot drop a later
identical retry. `togglePlugin` passes that token into `updateAgentConfig`
so one click does not adopt twice. `internal_dispatchAgentMap` reapplies that overlay so
an older queued `{ plugins }` snapshot or a stale config revalidation cannot
hide a later selection. A terminal persist failure of the latest owning write
releases the overlay so an authoritative fetch can converge; transport failure
does not roll back to a local snapshot. Jobs from an invalidated account must
not clear another account's pending overlay (the shared inbox key is reused
across switches; account reset already dropped the old account's state). The queue is not a database
lock: `SessionModel.updateConfig` is still read-merge-write, and the durable
worker remains the path that takes `SELECT … FOR UPDATE` on the agent row.

Entries are numbered `#N: …` lines and the numbering is kept dense: the fixed-memory editor
renumbers on every user save and `deleteMemory` renumbers the remainder, so deleting `#2`
makes `#3` become `#2`. Because numbers are injected at turn start and can shift underneath a
running turn, update/delete are content-verified: each call carries the index plus a `match`
snippet; on `not_found`/`mismatch` the tool refuses the write and returns the current numbered
entry list as the tool result so the model self-corrects within the same turn. Browser-fallback
writes serialize through one client promise chain (tool calls in a turn run concurrently).
Durable worker writes serialize with `SELECT … FOR UPDATE` on the agent row. Only `#N:`
lines are ever renumbered — free-form markdown in the doc is preserved verbatim.

The rollup is a selective extractor, not a consolidator. The prompt admits an item only if it
would change behavior in a future unrelated conversation, requires category-organized output
(never per-topic digests), and allows an exact `NO_CHANGES` sentinel reply; a sentinel run
advances watermarks without rewriting the document. Dirtiness is a hash of each topic's
compaction summary text: unchanged topics are never re-fed to the model, and a fully clean pass
costs zero LLM calls. The store-level `rollupAssistantMemory` action passes `force` for a full
rebuild; it is no longer exposed in the settings UI (the dream is the only automatic writer) but
remains available for tests and future callers. Output is bounded
twice — `max_tokens` on the request and a token-based post-cap (CJK-safe, replacing the old
char-only cap) — and multilingual preamble stripping guards the stored text. A refusal, error, or
empty output never overwrites the document; it records `lastError`, whose attempt count drives an
exponential backoff (10 min base, 6 h cap) honored by scheduled runs. Successful runs keep the
prior document in the one-slot backup, and `restoreAssistantMemoryBackup` swaps it with the
current text so restoring twice is a redo.

Rollup runs are single-flight per account scope and agent. Rollup currency is ACCOUNT-level only: the target session/agent is
captured at start, so the user can navigate to other sessions while the rollup runs in the
background and the result is still written to the captured agent — only an account switch or
scope reset aborts. In-flight agent ids are exposed in store state
(`assistantMemoryRollingAgentIds`) so callers can track the spinner across unmounts and navigation.
Topic listing and rollup persistence always use the server database. After a successful write, every agent-config SWR key in the account
scope is revalidated so sibling sessions bound to the same agent drop their stale copy.

## Scheduled memory dream (daily/weekly style learning)

The memory dream is a **server-side** Graphile job, not a browser `setInterval`.
`src/instrumentation.ts` starts `startAssistantMemoryDreamScheduler()` next to the
conversation-generation sweeper. Every 15 minutes the dispatcher reads `agents.chat_config`
and enqueues `assistant_memory_dream` for agents that are due.

**Schedule (UTC only).** `memoryDreamScheduleFrequency` (`off` / `daily` / `weekly`),
`memoryDreamScheduleTime` (`HH:mm`, default `02:00`), and `memoryDreamScheduleWeekday`
(0–6, Sunday–Saturday) live on agent `chatConfig`. Times and weekdays are UTC. Deprecated
toggles `enableDailyMemorySummary` / `enablePeriodicAssistantMemoryRollup` migrate at
read time to `daily` via `resolveMemoryDreamSchedule` (shared by the settings UI and the
dispatcher). There is no per-user timezone field.

**Scope.** The job lists topics linked to the agent whose `lastActivityAt` falls in the
**previous UTC calendar day**. Each topic feeds the prompt through its non-empty
`historySummary`; a topic without one falls back to a bounded excerpt of its own
user/assistant messages from that UTC window (`listRecentTextForMemoryDream`, newest
first, per-topic cap, same per-topic char budget as a summary), so never-compacted topics
no longer force a `no_summaries` skip. `no_summaries` now means the active topics had no
readable content at all. It does not scan all
assistant topics and does not compact topic history. Weekly schedule still uses the
**previous UTC calendar day** per run (not the whole week). The prompt
(`chainAssistantMemoryDream`) is a style-learning pass: communication style, interaction
patterns, tool habits, standing preferences — never per-topic recaps. Each topic block is
labeled `Source: topic summary` vs `Source: recent messages excerpt`. The model outputs
**only the new card body** (or `NO_CHANGES`), not a full document rewrite; prior dream
cards and fixed memory are read-only do-not-duplicate context in the prompt. When the new
card would push single-day count above **Keep dream cards** (N), a second completion
(`chainAssistantMemoryOverflowFold`) re-summarizes the existing overflow plus the newly
retired day cards into one overflow body. The prompt requires the new summary to be at
most 6400 characters after headers; if the first completion is over that cap **or** the
provider stops for a token limit (`finish_reason`/`stop_reason` `length`, `max_tokens`,
`MAX_TOKENS`), ChatHub asks the model to rewrite a shorter complete summary rather than
keeping a truncated draft. If both calls fail, remain over budget, or are token-truncated,
the scheduled job falls back to deterministic concat plus the 6400 cap. Settings-save and
that concat fallback keep an **opaque** overflow card opaque: they join its body with the
newly folded days, wrap the result in a checksummed
`[overflow:opaque-v3 n=<JS length> crc=<8 hex FNV-1a of UTF-8>]` header so a later cap
cannot reparse the payload as dated sections (even if a folded day contains `[date:day]`
or `[day]`), and retain the newest tail instead of rewriting it as a fake start-dated part
that would drop the whole range. The header is framing only when `n` and `crc` match the
remaining body; a typed look-alike is payload.

**Storage format.** Dynamic memory is one text field with numbered cards:

```
#1 [2026-08-27]:
- Communication style: …
#2 [2026-08-01..2026-08-13]:
[date:2026-08-01]
…
```

- Single-day tag `YYYY-MM-DD` — one successful dream for that history day; user **Regenerate** re-runs the dream for that UTC day only (`executeAssistantMemoryDream` `mode: 'regenerate'`).
- Range tag `YYYY-MM-DD..YYYY-MM-DD` only (including `date..date` when one day was folded) — merged overflow from **Keep dream cards** retention; edit/delete allowed, no regenerate. Labels that merely contain `..` (for example `important..notes`) stay custom cards and are not expanded as ranges.
- Overflow section headers are a full line `[date:YYYY-MM-DD]`. Newly written overflow cards begin with a magic line `[overflow:v1]` (stripped in the Memory editor and omitted from Copy). The line is a control marker **only** when a unique canonical `[date:]` parse reconstructs the outer `YYYY-MM-DD..YYYY-MM-DD` tag and the legacy `[YYYY-MM-DD]` parse does not. A leading `[overflow:v1]` that fails that unique-outer test stays visible content (including mixed pre-sentinel cards that also contain ordinary `[date:]` lines). Ordinary body lines that are exactly `[YYYY-MM-DD]`, `[date:YYYY-MM-DD]`, or `[overflow:v1]`, including lines that already start with backslashes, are stored with one extra leading backslash (logical n ↔ stored n+1) and round-trip through fold, editor, Copy, save, and cap. Ordinary `[date:YYYY-MM-DD]` content stays backslash-stuffed in the editor (`\[date:…]`) so a save cannot promote it to a heading. Card save re-attaches the stored control marker from the previous body rather than consuming a typed sentinel. Lines before the first accepted heading stay with the range-start part. Pre-sentinel documents are dual-parsed (canonical `[date:]` vs legacy bare `[YYYY-MM-DD]`); a parse is used only when it is the unique reconstruction of the outer card tag. If both parses match, or neither does, keep the original body and tag (opaque) and persist a validated `[overflow:opaque-v3 n=<JS string length> crc=<8 hex FNV-1a of UTF-8 payload>]` envelope (netstring-style length plus checksum). The first non-empty line is framing only when it matches that grammar **and** `n` equals the remaining body length **and** `crc` matches; otherwise the whole body is payload. A validated header is stripped in the editor and omitted from Copy so later caps and folds never dual-parse that payload, including when a newly folded day contains `[date:YYYY-MM-DD]` or `[YYYY-MM-DD]`. Bare `[overflow:opaque-v1]` and `[overflow:opaque-v2]` are never framing (Protobuf-style unknown-field preservation), including a leading occurrence on an unversioned range or an interim envelope from `fedec80487`/`5a28abacf9`/`fda686b6a7`. An unvalidated v3-shaped line is also payload. Opaque v3 stores the payload raw (no slash stuffing). Structured overflow still slash-stuffs part-body lines that are exactly `[overflow:opaque-v1]` or `[overflow:opaque-v2]` (logical n ↔ stored n+1). Fold and cap unwrap a validated v3 header only. Editor/Copy show the decoded payload, so a migrated interim v1/v2 marker stays visible as ordinary text. Cap migrates those interim envelopes by wrapping the former marker line plus payload inside v3. If the body exceeds the overflow limit, trim the oldest prefix and keep the tail. Folding a new day onto an opaque overflow card uses that same tail-preserving join (range bounds = original overflow plus folded dates). Do not classify unversioned cards by part counts or “any `[date:]` line.” Overflow truncation of structured cards measures the stuffed serialized body, including the sentinel, so the overflow card stays `<= ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS` (6400).
- Legacy unnumbered blobs are wrapped once as `#1 [legacy]:` on first append.
- Helpers: `parseDreamMemoryEntries`, `appendDreamMemoryEntry`, `enforceDreamMemoryRetention` (`memoryDreamMaxEntries`, default 14, clamp 1–90), `capDreamMemoryDocument` (lossy total **serialized** budget of `N × ASSISTANT_MEMORY_MAX_CHARS + ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS`, including entry headers). Single-day / custom / legacy card bodies stay `<= 3200`. The overflow range card stays `<= 6400`. Settings-save folds concatenate then cap; scheduled dream folds re-summarize via `chainAssistantMemoryOverflowFold` (rewrite once if over 6400 after headers **or** the provider reports a token-limit stop) with concat fallback. Scheduled runs skip append when a single-day card for that history date already exists (in addition to `lastDreamMarker`). They also skip append when the new card is a near-duplicate of an existing card — `findNearDuplicateDreamCard` (Jaccard ≥ 0.8 over CJK-aware bigram tokens, same tokenizer as `searchAssistantMemory`) returns the matching card and the run settles `skipped` with reason `duplicate_card` after committing the period marker, so paraphrase repeats of the same day summary do not accumulate.

**Markers and backoff.** Success and genuine no-op skips (`no_active_topics_yesterday`,
`no_summaries`, `no_changes`) write `assistantMemoryMeta.lastDreamMarker` (`YYYY-MM-DD` or
`YYYY-Www` for the **run period**, distinct from per-card `YYYY-MM-DD` history tags). Failures record `lastError` and honor the same exponential backoff as rollup
(10 min base, 6 h cap). Graphile `job_key` is
`assistant-memory-dream:<agentId>:<periodStamp>` with `unsafe_dedupe`.

**Concurrency.** Dream writes compare `agents.updatedAt` from the initial load and use a
compare-and-swap update. `SessionModel.updateConfig` omits snapshot timestamp columns on
write so Drizzle `$onUpdate` advances `updatedAt` on every user or rollup mutation. If the
user edits dynamic memory or restores a backup while the model
call is in flight, the stale dream result is dropped as `stale_conflict` instead of
overwriting newer memory or metadata.

**Debug.** Dream events share `CHATHUB_COMPACTION_DEBUG` / `chathub-compaction-debug`:
`dream_scheduler_tick` and `dream_scheduler_settled` with `path=assistant_memory_rollup`.
Scheduled Graphile jobs use `trigger=scheduled`; per-card regenerate uses `trigger=manual`.
Settle records include keep-N counts, topic source counts (`topicsWithSummary` /
`topicsWithExcerpt`), overflow envelope kind (`none` / `overflow_v1` /
`opaque_v3` / `opaque_payload`), and fold path (`none` / `llm` / `llm_rewrite` /
`concat_fallback`). They are server-emitted and never include card bodies, overflow
text, or message excerpts. After the daily topic-note scheduler was removed, `planner_settled` with
`trigger=scheduled` on a topic path is a regression.

The settings Memory tab **Dreaming Memory** group exposes topic snippets, the UTC dream
schedule, **Keep dream cards** (`memoryDreamMaxEntries`), and a **dynamic memory** card list
(Fixed Memory pattern: per-card edit/delete, server-side **Regenerate** on single-day cards,
Copy, Clear — no whole-document Save, no Add). The dream schedule block
shows the last scheduled dream attempt (`assistantMemoryMeta.lastDreamAt`) plus a failure
hint when that attempt recorded `lastDreamStatus: 'failed'`. Both fields are written only
by the scheduled dream on every committed attempt (success, genuine no-op skip, or
failure), so a legacy/manual rollup timestamp (`lastRollupAt`) is never misattributed as
a dream run and a failed attempt never pairs a stale success time with the failure hint.
Per-card regenerate uses `agent.regenerateDreamMemory` tRPC → `executeAssistantMemoryDream`
with `historyDate`, `replaceIndex`, and content `match` snippet (same stale_conflict CAS as
scheduled runs). The store-level `rollupAssistantMemory` /
`restoreAssistantMemoryBackup` actions remain for tests and future callers.

Assistant-wide memory rollup is an agent-store action, while `ChatService` reads the agent store when
assembling requests. The action therefore lazy-loads `@/services/chat` only when a rollup runs; a
static import would create an agent-store initialization cycle in the Next.js server bundle. Because
module loading is asynchronous, the action revalidates its captured account and agent context before
calling the service.

The memory-archive snippets attached to a topic are prefixes of successive versions of the same
cumulative summary, so injection drops any excerpt already contained in the current summary text or
in a newer kept excerpt instead of repeating it.

The settings Memory tab edits both tiers through the scoped AgentSetting store, so the defaults
page and group-member drawers target the agent they display. The Compact group (Assist preset,
auto-compact switch, threshold) lives on the **Chat Preference** tab, not the Memory tab. The
topic compaction summary is topic-scoped and
therefore lives outside assistant settings: a shared `TopicSummaryViewer` drawer (markdown +
model tag + copy/export) opens from the token-badge popover for the active topic and from each
topic's dropdown menu for any topic with a summary.

Memory UI actions do not gate their visible state on the write promise. Config
writes serialize per account and session. Public `updateAgentConfig` writes each
have their own AbortController, so a later save in another session cannot cancel
this one, and account reset aborts every owned public controller. Pending plugin
intent survives older queued snapshots and stale config revalidation. A
terminal persist failure of the latest owning write releases that overlay so a
server fetch can converge; an old-account job must not clear the current
account's overlay. A failed
or fenced promise is not
proof that the server never committed. Actions apply local state
optimistically, report success/failure via toast, and on failure refetch the agent config to
converge on the database truth. The refetch goes through the scoped store's `onRefreshConfig`
callback, which every settings surface wires to its own source (the workspace drawer and mobile
chat settings page refresh the displayed agent via `internal_refreshAgentConfig`; the defaults
page re-reads user state via `refreshUserState`). If that refetch also fails (or is not wired), the **current local draft** stays
visible and marked dirty so Save remains retryable — including edits typed while
the write or refetch was in flight. The client does not restore the operation's
snapshot or roll back to a stale copy, because the original write may already
have committed.
`updateAgentConfig` drops a write's controller when that request
settles, so completed requests can no longer be aborted retroactively. Rapid
slider edits serialize instead of aborting the previous patch. The scoped store's `onConfigChange` may
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
- `src/server/services/assistantMemoryDream/schedule.test.ts`
- `src/server/services/assistantMemoryDream/execute.test.ts`

## Key source references

- `src/services/chat/contextEngineering.ts`
- `src/helpers/contextCompaction.ts`
- `src/store/chat/slices/aiChat/actions/memory.ts`
- `src/server/services/assistantMemoryDream/`
- `packages/context-engine/src/pipeline.ts`
- `packages/context-engine/src/processors/`
- `packages/context-engine/src/providers/`

The durable worker builds the same pipeline in
`src/server/services/conversationGeneration/payload.ts` so background
generation matches the browser request shape. See
[Durable conversation generation](durable-conversation-generation.md).
