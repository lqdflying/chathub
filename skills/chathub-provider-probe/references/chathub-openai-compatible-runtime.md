# ChatHub OpenAI-Compatible Runtime Reference

Use this reference when interpreting probe output against the current repo behavior.

Key files:

- `src/services/chat/index.ts`: sets `apiMode: 'responses'` when the provider config enables Responses API.
- `src/store/chat/slices/aiChat/actions/generateAIChat.ts`: strips `params.max_tokens` unless the agent's max-tokens toggle is enabled.
- `packages/model-runtime/src/providers/openaicompatible/index.ts`: allowlists request fields for OpenAI-compatible gateways.
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`: converts ChatHub chat payloads into Chat Completions or Responses API calls.
- `packages/model-runtime/src/core/openaiCompatibleFactory/openaicompatCache.ts`: derives `prompt_cache_key` for GPT/Codex-compatible models when provider response state is enabled.
- `src/app/[variants]/(main)/settings/provider/features/ProviderConfig/index.tsx`: exposes the OpenAI-compatible API route radio, cache preset, and Custom-only cache and Responses parameter matrices.

Current behavior to compare:

- Base URL is used directly by the OpenAI SDK. A gateway that serves OpenAI-compatible APIs under `/v1` must be configured with a base URL ending in `/v1`.
- OpenAI-compatible Responses mode is opt-in through provider config.
- OpenAI-compatible cache behavior is configured by `openAICompatCache`:
  - Chat Completions can send top-level `prompt_cache_key`, a `Session_id` header, both, or neither.
  - Responses can send derived `prompt_cache_key`, a `Session_id` header, and `store` as default/true/false.
  - Responses parameter compatibility is configured by `openAICompatResponsesParams`: `max_tokens`, `max_output_tokens`, `truncation`, and `verbosity` send shape.
  - The old `responseStateMode: "provider"` field is treated as legacy input and normalizes to the `pptoken.org` Responses preset when no cache matrix exists.
- In Responses mode, ChatHub converts `messages` to Responses `input`, maps `reasoning_effort` into `reasoning.effort`, deletes frequency/presence penalties, applies the configured Responses cache hints, applies the configured Responses parameter matrix, and sets `stream: true` by default or omits `stream` if the user disables streaming.
- ChatHub does not currently use `previous_response_id` for OpenAI-compatible provider state.
- ChatHub's OpenAI-compatible path does not emit Anthropic `cache_control` content blocks.
- ChatHub's OpenAI-compatible Chat Completions path now supports configured `prompt_cache_key` and `Session_id`; if both are disabled, any chat-route cache hit is automatic provider prefix caching.
- Cache troubleshooting debug:
  - `DEBUG_OPENAICOMPATIBLE_CACHE=1` logs redacted Chat/Responses request fingerprints, turn/input shapes, tool names/count, cache-key/session-header summaries, and final cached-token usage when usage is available.
  - `DEBUG_OPENAICOMPATIBLE_CHAT_COMPLETION=1` prints full Chat Completions request and stream/response data.
  - `DEBUG_OPENAICOMPATIBLE_RESPONSES=1` prints full Responses request and stream/response data.
  - Prefer the redacted cache debug first; full route debug can expose prompt, tool, and file context.
  - For the `apikl.ai` Responses preset, expected cache debug is `promptCacheKey.present:true`, `sessionId.present:false`, and `params.hasTextVerbosity:true`. If verbosity is present but `promptCacheKey` is absent, ChatHub is applying only part of the saved preset/config.

Preset recommendations:

- `pptoken.org`: Responses API on; Chat Completions cache off; Responses `prompt_cache_key` derived, no `Session_id`, `store:true`. This matches the legacy ChatHub response-state behavior.
- `apikl.ai`: Responses API on; Chat Completions `prompt_cache_key + Session_id`; Responses `prompt_cache_key` derived, no `Session_id`, `store:default` (omit `store`).
- Use `Custom` when the probe confirms a different per-endpoint or Responses-parameter combination; built-in presets keep the detailed matrix hidden.

Compatibility conclusions:

- A provider works with Chat Completions when `/chat/completions` returns OpenAI-style JSON/SSE and the stream parser can read it.
- A provider works with Responses mode when `/responses` returns OpenAI Responses stream events or JSON that the OpenAI SDK and `OpenAIResponsesStream` can parse.
- A provider works with ChatHub cache-hit logic as-is when the confirmed strategy can be expressed by the settings matrix: Chat `prompt_cache_key`, Chat `Session_id`, Responses `prompt_cache_key`, Responses `Session_id`, and Responses `store`. Responses request-parameter compatibility can also be expressed in Custom mode for `max_tokens`, `max_output_tokens`, `truncation`, and `verbosity`.
- Chat Completions cache behavior must be tested independently from Responses cache behavior. A `/responses` hit is not evidence that `/chat/completions` will hit.
- If `prompt_cache_key` works only when paired with `Session_id`, enable both fields for that endpoint in the matrix.
- If only backend-derived keys work, ChatHub must keep the derivation seed stable: model id, reasoning effort, tools/functions, system prompt, and first user message.
- If only Anthropic `cache_control` blocks work, use Anthropic-compatible runtime semantics or add a provider-specific OpenAI-compatible adapter after confirming the gateway accepts that non-OpenAI shape.
- If only `previous_response_id` produces reuse, ChatHub needs a runtime change to use provider-managed response state.
