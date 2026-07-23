# Context Engineering and Message Pipeline

ChatHub does not send raw UI messages directly to the model provider. Instead, it runs conversation state through a context-engineering pipeline that injects roles, rewrites content, resolves placeholders, and reorders tool messages before the provider call.

## Pipeline entrypoint

The main entrypoint is `src/services/chat/contextEngineering.ts`. It constructs a `ContextEngine` pipeline from `packages/context-engine` and then feeds it the current message list. The pipeline currently includes:

- history truncation
- system-role injection
- inbox guide injection
- tool system-role injection
- history summary injection
- input template processing
- placeholder variable processing
- message content processing
- tool call processing
- tool message reordering
- message cleanup

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

A notable implementation detail in the current code is proxy image URL resolution. After MCP tool calls, refreshed messages may contain `/webapi/files/...` URLs that are not directly accessible to providers, so `contextEngineering` resolves them back to public URLs before the pipeline runs.

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

## Package boundary

`packages/context-engine` holds the reusable pipeline and processors. It is shared logic rather than app-only code, which is why placeholder handling and message cleanup changes often show up there first.

## Change guidance

When editing context shaping, review both the pipeline order and the processor tests. Small changes in ordering can change the final model input in ways that are hard to spot from the UI.

Useful test locations include:

- `packages/context-engine/src/processors/__tests__/MessageContent.test.ts`
- `packages/context-engine/src/processors/__tests__/PlaceholderVariables.test.ts`
- `src/services/chat/contextEngineering.test.ts`

## Key source references

- `src/services/chat/contextEngineering.ts`
- `packages/context-engine/src/pipeline.ts`
- `packages/context-engine/src/processors/`
- `packages/context-engine/src/providers/`
