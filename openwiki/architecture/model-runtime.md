# Model Runtime and Provider Adapters

The model runtime package is the main abstraction layer for talking to LLM providers. It owns provider initialization, OpenAI-compatible behavior, stream transformations, error normalization, and provider-specific tests.

## What it does

`packages/model-runtime` exports the runtime used by the server module in `src/server/modules/ModelRuntime/index.ts`. That server entrypoint resolves credentials and base URLs from the user payload and environment, then calls `ModelRuntime.initializeWithProvider(...)`.

The package itself contains the core pieces for provider execution:

- `core/ModelRuntime.ts` and `core/BaseAI.ts` — runtime abstractions
- `core/openaiCompatibleFactory/` — generic OpenAI-compatible provider factory and helpers
- `core/contextBuilders/` — provider-specific message/context conversion
- `core/streams/` — stream adapters, including OpenAI Responses handling
- `utils/handleOpenAIError.ts` — provider error normalization
- `providerTestUtils.ts` — shared test scaffolding for provider behavior

## Important runtime behavior

Recent git history shows active work around OpenAI-compatible and Anthropic-compatible behavior. Notable themes:

- response cache hints and cache-key derivation for OpenAI-compatible providers
- handling response streams and non-stream-to-stream conversion
- skipping undefined SSE chunks
- stripping volatile or provider-incompatible fields from messages
- provider-specific auth modes and base URL handling
- OpenAI SDK upgrade compatibility, including stable error normalization and Responses stream typing changes

These changes matter because provider integrations are not just thin API wrappers; they must normalize request shape, stream semantics, and provider-specific edge cases.

## OpenAI-compatible path

The OpenAI-compatible factory is central to this repo's model support. Git history and the current implementation show it is used to support several compatible providers and variants, including the newer Responses API path.

The recent OpenAI SDK upgrade kept this path working by normalizing the new `Headers`-backed APIError shape and by adapting Responses-stream parsing where the SDK now types some annotation payloads as `unknown`.

Provider-specific cache hint combinations are documented in [OpenAI-compatible cache matrix](../integrations/openai-compatible-cache-matrix.md).

### Streaming handshake and keepalives

Streaming OpenAI-compatible Chat Completions and Responses requests do not wait for the SDK's upstream `create(...)` promise before returning ChatHub's `Response`. The runtime wraps that pending request as a deferred async iterable, opens the downstream SSE response with an immediate `: chathub-ping` comment, and sends the same comment after 10 seconds of idle time. This keeps the browser, reverse proxy, and load balancer connection active while a provider is preparing a slow post-tool continuation.

Keepalives are emitted only between complete SSE frames, never between an `id`, `event`, and `data` sequence. The response uses `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`; ChatHub's EventSource parser and `fetchSSE` consumer both ignore comment-only frames. Canceling the downstream body or the original request aborts the linked upstream request. If opening the deferred provider stream fails, its normalized provider metadata is converted into the normal terminal SSE error event instead of surfacing as an untyped browser `TypeError: Load failed`.

### Responses stream errors

Responses mode expects `/v1/responses` to return Server-Sent Events whose `data`
values are valid JSON. The OpenAI SDK parses each event while advancing its async
iterator. A provider, WAF, or reverse proxy that returns an HTML error page under a
successful streaming response can therefore fail with a `SyntaxError` beginning
with `Unexpected token '<'`.

ChatHub converts iterator failures from both the first read and later reads into a
terminal protocol error. HTML parse failures are reported as `html_response`;
other JSON syntax failures are reported as `invalid_json`. User-facing errors do
not include the raw HTML, malformed event body, or SDK stack. For
`html_response`, verify that the configured endpoint implements `/v1/responses`
streaming and inspect provider or reverse-proxy logs for the underlying response.

### Fixed OpenAI-compatible catalog

The `openaicompatible` provider intentionally uses a fixed, non-editable model list instead of exposing arbitrary model fetching. Its chat catalog clones `gpt-5.6-sol` and `gpt-5.5` from the native OpenAI model bank, preserves their option settings, and disables the native-search ability so search remains an explicit compatible-provider option. `gpt-image-2` remains the fixed image model.

`gpt-5.5` remains the provider connection-check model because compatible gateways may expose GPT-5.5 before they add GPT-5.6 Sol.

GPT-5 reasoning effort is normalized by model before the request reaches the runtime:

- `gpt-5.6-sol`: `none`, `low`, `medium`, `high`, `xhigh`, `max`
- GPT-5.5 family: `low`, `medium`, `high`, `xhigh`; saved `none` or `minimal` values map to `low`
- Earlier GPT-5 models: `minimal`, `low`, `medium`, `high`
- Unsupported saved values from a model switch fall back to `medium`

The internal request uses `reasoning_effort` for both compatible API modes. Chat Completions forwards it as the top-level `reasoning_effort` field. Responses removes that top-level field and merges it into `reasoning: { effort }`, preserving other documented reasoning options such as `summary`. This is fixed endpoint mapping, not a provider setting: the OpenAI-compatible provider has no separate “Responses reasoning effort” shape selector. Legacy saved selector values are discarded. This mapping permits GPT-5.6 Sol's `max` value without introducing a second upstream field.

### Moonshot Kimi K3

`kimi-k3` is an enabled Moonshot catalogue entry, not ChatHub's globally selected initial model. The global default remains the existing OpenAI model and provider. K3's built-in card advertises function calling, structured output, reasoning, vision, and video with a `1_048_576`-token context window and the documented maximum completion limit.

K3 always uses reasoning. The Moonshot adapter therefore sends the top-level `reasoning_effort: "max"` field, omits the K2.x `thinking` object, and strips mutable sampling fields (`temperature`, `top_p`, `n`, `presence_penalty`, and `frequency_penalty`) before the request reaches the provider. K3 has no model gear toggle because there is no supported user-selectable reasoning mode.

For multi-turn conversations and tool calls, the adapter replays the complete assistant message, including `tool_calls` and `reasoning_content`. Application tools and `tool_choice` remain available. ChatHub-managed browsing remains separate from Moonshot's `$web_search`: K3 does not receive the built-in Moonshot search tool because the current K3 documentation warns that web search is still being updated and is not recommended for near-term production workflows.

The default ChatHub Moonshot route is the China endpoint `https://api.moonshot.cn/v1`, with `MOONSHOT_PROXY_URL` and request/user-provider `baseURL` taking precedence. The global Kimi documentation uses `https://api.moonshot.ai/v1`; deployments targeting that endpoint must configure the base URL explicitly and should confirm that the account and endpoint expose K3.

## Model fetch normalization

Providers that expose `/models` can return new model ids before ChatHub's built-in model list is refreshed. The runtime still needs to normalize fetched ids through provider-specific capability rules so the UI can detect function calling, reasoning, vision, video, search, and image-output support.

DeepSeek, MiniMax, and Moonshot use provider-specific model fetchers rather than a raw generic list. The fetchers call the shared model parser with provider configs, and the database repository adds read-time-only `settings.extendParams` for fetched models where the remote model table cannot store option-panel settings. This keeps fetched DeepSeek V4 and MiniMax M-series models usable in the model option panel, while Moonshot Kimi K2.7 Code and Kimi K3 remain reasoning-capable without a toggle because the provider forces thinking/preserved reasoning. Fetched K3 variants receive reasoning, vision, and video capabilities from the Moonshot keyword normalizer when an exact built-in card is unavailable.

## Provider request debug

Moonshot, MiniMax, DeepSeek, and Anthropic-compatible troubleshooting can use provider-specific chat debug flags. In addition to the existing raw payload/stream logs, these flags emit a structured `[provider-debug:request]` summary with hashed endpoint origin/path, path depth, query-key names, upstream route, model, turn shape, tool count/fingerprint, and payload fingerprint. URL credentials, hosts, path segments, query values, authorization secrets, and tool names are omitted:

- `DEBUG_MOONSHOT_CHAT_COMPLETION=1`
- `DEBUG_MINIMAX_CHAT_COMPLETION=1`
- `DEBUG_DEEPSEEK_CHAT_COMPLETION=1`
- `DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION=1`

Use this first for endpoint/path problems such as `url.not_found`, then inspect the raw payload only if the structured request shape is not enough. The raw debug logs can include prompt and response content.

Be careful when editing this area because it affects:

- streaming and non-streaming request behavior
- model selection for chat vs. non-chat models
- response cache hints and cache stability
- error translation and provider-specific fallbacks
- Responses API routing via `useResponse` and `useResponseModels`

## Change guidance

If you modify provider support, update the tests next to the implementation. The current repo already has provider-focused tests in:

- `packages/model-runtime/src/core/openaiCompatibleFactory/index.test.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.test.ts`
- `packages/model-runtime/src/providers/openai/index.test.ts`
- `packages/model-runtime/src/providers/google/index.test.ts`
- `packages/model-runtime/src/providerTestUtils.test.ts`

For changes tied to the OpenAI SDK upgrade path, pay special attention to error-shape assertions and any stream fixtures that depend on Responses annotations or usage payloads.

## Key source references

- `packages/model-runtime/package.json`
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.ts`
- `packages/model-runtime/src/core/contextBuilders/anthropic.ts`
- `packages/model-runtime/src/utils/handleOpenAIError.ts`
- `src/server/modules/ModelRuntime/index.ts`
