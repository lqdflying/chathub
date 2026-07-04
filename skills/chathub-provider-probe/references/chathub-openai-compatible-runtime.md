# ChatHub OpenAI-Compatible Runtime Reference

Use this reference when interpreting probe output against the current repo behavior.

Key files:

- `src/services/chat/index.ts`: sets `apiMode: 'responses'` when the provider config enables Responses API.
- `src/store/chat/slices/aiChat/actions/generateAIChat.ts`: strips `params.max_tokens` unless the agent's max-tokens toggle is enabled.
- `packages/model-runtime/src/providers/openaicompatible/index.ts`: allowlists request fields for OpenAI-compatible gateways.
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`: converts ChatHub chat payloads into Chat Completions or Responses API calls.
- `packages/model-runtime/src/core/openaiCompatibleFactory/openaicompatCache.ts`: derives `prompt_cache_key` for GPT/Codex-compatible models when provider response state is enabled.
- `src/app/[variants]/(main)/settings/provider/features/ProviderConfig/index.tsx`: exposes the OpenAI-compatible cache preset and per-endpoint cache matrix.

Current behavior to compare:

- Base URL is used directly by the OpenAI SDK. A gateway that serves OpenAI-compatible APIs under `/v1` must be configured with a base URL ending in `/v1`.
- OpenAI-compatible Responses mode is opt-in through provider config.
- OpenAI-compatible cache behavior is configured by `openAICompatCache`:
  - Chat Completions can send top-level `prompt_cache_key`, a `Session_id` header, both, or neither.
  - Responses can send derived `prompt_cache_key`, a `Session_id` header, and `store` as default/true/false.
  - The old `responseStateMode: "provider"` field is treated as legacy input and normalizes to the `pptoken.org` Responses preset when no cache matrix exists.
- In Responses mode, ChatHub converts `messages` to Responses `input`, maps `reasoning_effort` into `reasoning.effort`, deletes frequency/presence penalties, applies the configured Responses cache hints, and sets `stream: true` by default or omits `stream` if the user disables streaming.
- The current OpenAI-compatible provider forwards `max_tokens` into Responses mode when the agent max-tokens toggle is enabled.
- The current OpenAI-compatible provider forwards `verbosity` top-level in Responses mode. Some gateways require `text: { verbosity }` instead.
- ChatHub does not currently use `previous_response_id` for OpenAI-compatible provider state.
- ChatHub's OpenAI-compatible path does not emit Anthropic `cache_control` content blocks.
- ChatHub's OpenAI-compatible Chat Completions path now supports configured `prompt_cache_key` and `Session_id`; if both are disabled, any chat-route cache hit is automatic provider prefix caching.

Preset recommendations:

- `pptoken.org`: Responses API on; Chat Completions cache off; Responses `prompt_cache_key` derived, no `Session_id`, `store:true`. This matches the legacy ChatHub response-state behavior.
- `apikl.ai`: Responses API on; Chat Completions `prompt_cache_key + Session_id`; Responses `prompt_cache_key` derived, no `Session_id`, `store:false`.
- Use `Custom` when the probe confirms a different per-endpoint combination.

Compatibility conclusions:

- A provider works with Chat Completions when `/chat/completions` returns OpenAI-style JSON/SSE and the stream parser can read it.
- A provider works with Responses mode when `/responses` returns OpenAI Responses stream events or JSON that the OpenAI SDK and `OpenAIResponsesStream` can parse.
- A provider works with ChatHub cache-hit logic as-is when the confirmed strategy can be expressed by the settings matrix: Chat `prompt_cache_key`, Chat `Session_id`, Responses `prompt_cache_key`, Responses `Session_id`, and Responses `store`.
- Chat Completions cache behavior must be tested independently from Responses cache behavior. A `/responses` hit is not evidence that `/chat/completions` will hit.
- If `prompt_cache_key` works only when paired with `Session_id`, enable both fields for that endpoint in the matrix.
- If only backend-derived keys work, ChatHub must keep the derivation seed stable: model id, reasoning effort, tools/functions, system prompt, and first user message.
- If only Anthropic `cache_control` blocks work, use Anthropic-compatible runtime semantics or add a provider-specific OpenAI-compatible adapter after confirming the gateway accepts that non-OpenAI shape.
- If only `previous_response_id` produces reuse, ChatHub needs a runtime change to use provider-managed response state.
