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

## General Instruction composition

The top-level `General Instruction` is persisted inside the existing user general settings JSON and
is composed at request time rather than copied into assistant definitions. `src/services/chat/index.ts`
trims and joins the general instruction before the active assistant role with one blank line, then
passes the effective role into `contextEngineering` for normal assistant requests. Group-member
generation uses the same composer before adding group-member guidelines, and token estimation mirrors
that composition so the displayed context budget includes the shared instruction.

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
