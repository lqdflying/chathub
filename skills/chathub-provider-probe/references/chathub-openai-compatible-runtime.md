# ChatHub OpenAI-Compatible Runtime Reference

Use this reference when interpreting probe output against the current repo behavior.

Key files:

- `src/services/chat/index.ts`: sets `apiMode: 'responses'` when the provider config enables Responses API.
- `src/store/chat/slices/aiChat/actions/generateAIChat.ts`: strips `params.max_tokens` unless the agent's max-tokens toggle is enabled.
- `packages/model-runtime/src/providers/openaicompatible/index.ts`: allowlists request fields for OpenAI-compatible gateways.
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`: converts ChatHub chat payloads into Chat Completions or Responses API calls.
- `packages/model-runtime/src/core/openaiCompatibleFactory/openaicompatCache.ts`: derives `prompt_cache_key` for GPT/Codex-compatible models when provider response state is enabled.

Current behavior to compare:

- Base URL is used directly by the OpenAI SDK. A gateway that serves OpenAI-compatible APIs under `/v1` must be configured with a base URL ending in `/v1`.
- OpenAI-compatible Responses mode is opt-in through provider config.
- In Responses mode, ChatHub converts `messages` to Responses `input`, maps `reasoning_effort` into `reasoning.effort`, deletes frequency/presence penalties, and sets:
  - `store: true` only when OpenAI-compatible response state is enabled.
  - `prompt_cache_key` only when response state is enabled and the model id looks like GPT/Codex.
  - `stream: true` by default, or omits `stream` if the user disables streaming.
- The current OpenAI-compatible provider forwards `max_tokens` into Responses mode when the agent max-tokens toggle is enabled.
- The current OpenAI-compatible provider forwards `verbosity` top-level in Responses mode. Some gateways require `text: { verbosity }` instead.
- ChatHub does not currently use `previous_response_id` for OpenAI-compatible provider state.

Compatibility conclusions:

- A provider works with Chat Completions when `/chat/completions` returns OpenAI-style JSON/SSE and the stream parser can read it.
- A provider works with Responses mode when `/responses` returns OpenAI Responses stream events or JSON that the OpenAI SDK and `OpenAIResponsesStream` can parse.
- A provider works with ChatHub cache-hit logic as-is only if the `store: true` + `prompt_cache_key` strategy produces cache-hit usage or dashboard-confirmed hits.
- If only `previous_response_id` produces reuse, ChatHub needs a runtime change to use provider-managed response state.
