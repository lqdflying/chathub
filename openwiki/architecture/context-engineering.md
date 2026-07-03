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

## Why it exists

This pipeline is the reason the app can support features like:

- assistant-specific system prompts
- session-level inbox guidance
- history summaries and compaction
- tool calls and tool role injection
- file/image context handling
- provider-specific formatting for messages and placeholders

A notable implementation detail in the current code is proxy image URL resolution. After MCP tool calls, refreshed messages may contain `/webapi/files/...` URLs that are not directly accessible to providers, so `contextEngineering` resolves them back to public URLs before the pipeline runs.

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
