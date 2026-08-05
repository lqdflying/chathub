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

Responses success still requires an explicit `response.completed` event with
`status: completed`. If the transport closes normally without any Responses
terminal event, the strict SSE transformer emits the existing
`unexpected_end` error. This guard must not infer success from a clean TCP/HTTP
EOF because a gateway can truncate a valid stream after partial output.

Provider cache diagnostics classify terminal failures without changing the
user-visible SSE payload:

- `missing_terminal_event` covers strict EOF and uses
  `terminalReason=unexpected_end`.
- `upstream_iterator_exception` covers stream-open/read failures, including
  `html_response`, `invalid_json`, and other sanitized provider errors.
- `provider_terminal_event` covers explicit `response.failed`,
  `response.incomplete`, `error`, invalid completed statuses, and stream-chunk
  correlation/parsing failures.
- `request_cancelled` covers downstream consumer cancellation and uses
  `terminalReason=consumer_cancelled`.

Only allowlisted `terminalSource` and `terminalReason` values enter structured
diagnostics. Provider-specific codes may use the existing bounded `errorCode`
field; prompts, raw chunks, URLs, response IDs, messages, and stacks are never
copied into these fields. A repeated `unexpected_end` at a consistent elapsed
boundary usually points to a gateway, reverse-proxy, or upstream model timeout,
not ChatHub's terminal-event parser. ChatHub's SSE heartbeats keep only the
downstream browser connection active and cannot extend the upstream provider
request.

### Fixed OpenAI-compatible catalog

The `openaicompatible` provider intentionally uses a fixed, non-editable model list instead of exposing arbitrary model fetching. Its chat catalog clones `gpt-5.6-sol` and `gpt-5.5` from the native OpenAI model bank, preserves their option settings, and disables the native-search ability so search remains an explicit compatible-provider option. Both compatible chat cards override the native `1_050_000`-token context window with the shared `258_000`-token compatibility limit while retaining the `128_000` maximum output. The override is provider-scoped and therefore controls token estimates and automatic context-compaction watermarks only when the active provider is `openaicompatible`. Repository reads reapply the fixed context limit after merging saved model rows, so stale database values from older releases cannot restore the native window. `gpt-image-2` remains the fixed image model.

`gpt-5.5` remains the provider connection-check model because compatible gateways may expose GPT-5.5 before they add GPT-5.6 Sol.

The OpenAI-compatible Images API path uses `/images/generations` for
text-to-image requests and `/images/edits` when reference images are present.
Edit defaults are model-aware: GPT Image 1 and GPT Image 1.5 default
`input_fidelity` to `high`, while GPT Image 2, GPT Image 1 Mini, and DALL·E
requests omit the field. GPT Image 2 always processes reference inputs at high
fidelity and rejects the parameter. Explicit stale `input_fidelity` values are
therefore stripped from model families that reject it. Base64 responses use the
response's `output_format` metadata when available, then the requested
`output_format`, and finally PNG, so JPEG and WebP bytes receive the correct data
URI MIME type. The fixed GPT Image 2 card still exposes the existing preset
image controls; flexible arbitrary resolutions and new output/moderation
controls require separate parameter meta-schema and UI work.

GPT-5 reasoning effort is normalized by model before the request reaches the runtime:

- `gpt-5.6-sol`: ChatHub exposes `high`, `xhigh`, `max`
- GPT-5.5 family: ChatHub exposes `high`, `xhigh`
- Earlier GPT-5 models: `minimal`, `low`, `medium`, `high`
- Lower, unset, or otherwise unsupported saved values for GPT-5.5 and GPT-5.6 Sol resolve to `high`; earlier GPT-5 models continue to fall back to `medium`

OpenAI's API accepts lower reasoning efforts for GPT-5.5 and GPT-5.6, but ChatHub deliberately applies a `high` quality floor to these model families. Persisted lower values remain valid for backward compatibility and are normalized at display and request time. ChatHub sends the resolved `high` value explicitly when no effort was previously saved so the provider's `medium` default cannot bypass the floor.

The internal request uses `reasoning_effort` for both compatible API modes. Chat Completions forwards it as the top-level `reasoning_effort` field. Responses removes that top-level field and merges it into `reasoning: { effort }`, preserving other documented reasoning options such as `summary`. This is fixed endpoint mapping, not a provider setting: the OpenAI-compatible provider has no separate “Responses reasoning effort” shape selector. Legacy saved selector values are discarded. This mapping permits GPT-5.6 Sol's `max` value without introducing a second upstream field.

### Moonshot Kimi K3

`kimi-k3` is an enabled Moonshot catalogue entry, not ChatHub's globally selected initial model. The global default remains the existing OpenAI model and provider. K3's built-in card advertises function calling, structured output, reasoning, vision, and video with a `1_048_576`-token context window and the documented maximum completion limit.

K3 always uses reasoning. The Moonshot adapter therefore sends the top-level `reasoning_effort: "max"` field, omits the K2.x `thinking` object, and strips mutable sampling fields (`temperature`, `top_p`, `n`, `presence_penalty`, and `frequency_penalty`) before the request reaches the provider. K3 has no model gear toggle because there is no supported user-selectable reasoning mode.

For multi-turn conversations and tool calls, the adapter replays the complete assistant message, including `tool_calls` and `reasoning_content`. Application tools and `tool_choice` remain available. ChatHub-managed browsing remains separate from Moonshot's `$web_search`: K3 does not receive the built-in Moonshot search tool because the current K3 documentation warns that web search is still being updated and is not recommended for near-term production workflows.

The default ChatHub Moonshot route is the China endpoint `https://api.moonshot.cn/v1`, with `MOONSHOT_PROXY_URL` and request/user-provider `baseURL` taking precedence. The global Kimi documentation uses `https://api.moonshot.ai/v1`; deployments targeting that endpoint must configure the base URL explicitly and should confirm that the account and endpoint expose K3.

### Zhipu GLM-5.2

`zhipu` is a first-class OpenAI-compatible provider built with the shared factory. Its default ChatHub route is the China endpoint `https://open.bigmodel.cn/api/paas/v4`; deployments targeting the international `https://api.z.ai/api/paas/v4/` endpoint must configure the base URL explicitly. `glm-5.2` is the enabled default model with a `1_048_576`-token context window and a `65_536`-token default `max_tokens` (128K maximum).

The Zhipu adapter (`packages/model-runtime/src/providers/zhipu/index.ts`) is a single `buildZhipuPayload` function plus the factory registration. It translates the shared `ChatStreamPayload` into Zhipu's request body:

- **Thinking object** — `thinking: { type: 'enabled' | 'disabled', clear_thinking?: false }`. The adapter strips Anthropic-style `budget_tokens` and Moonshot-style `keep` that the service layer may attach, because Zhipu rejects both. `thinking.type` defaults to `enabled` on thinking-capable models (`glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.5`).
- **reasoning_effort** — forwarded only on `glm-5.2` and above, and only when thinking is enabled. The chat service maps the UI `skip` value to the API `minimal` value before it reaches the runtime; the runtime forwards the value verbatim.
- **do_sample** — set to `false` (greedy decoding) when `temperature === 0`; sampling params are then omitted because Zhipu ignores them when `do_sample` is false.
- **tool_stream** — set to `true` when streaming with function tools, so Zhipu streams tool-call arguments incrementally (`tool_call.index` accumulation).
- **tool_choice** — coerced to `'auto'` when tools are present; Zhipu rejects `none`, `required`, and specific-function selection.
- **web_search tool** — injected into the `tools` array when `enabledSearch` is set, using `{ type: 'web_search', web_search: { search_engine: 'search_pro_jina', enable: true } }`.
- **GLM-5.2 thinking + search/JSON mutual exclusion** — on `glm-5.2` only, `enabledSearch` or `response_format: json_object` forces `thinking.type` to `disabled` because Zhipu documents web search and JSON mode as non-thinking-only on GLM-5.2.
- **Preserved Thinking** — when `thinking.clear_thinking === false`, the adapter keeps the internal `reasoning` field on assistant messages so the shared `convertOpenAIMessages` context builder replays it as `reasoning_content`; otherwise it strips `reasoning` to match Zhipu's default behavior of discarding historical thinking.

The shared `OpenAIStream` already extracts Zhipu's `delta.reasoning_content` (same field as DeepSeek/Moonshot) and Zhipu's `web_search` citations, so no custom stream handler is required. The `convertOpenAIMessages` `reasoning_content` provider gate is a negative check on `openaicompatible` only, so Zhipu keeps `reasoning_content` replay by default — no provider-list change was needed there.

The default model list ships 8 GLM cards (`glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`, `glm-4.5`, `glm-5v-turbo`). Only `glm-5.2` carries `zhipuReasoningEffort` in its `extendParams`; the rest carry `enableReasoning` and `zhipuClearThinking`. Fetched Zhipu models receive inferred `extendParams` at read time in `packages/database/src/repositories/aiInfra/index.ts` because the remote model table cannot persist `settings.extendParams`.

## Model fetch normalization

Providers that expose `/models` can return new model ids before ChatHub's built-in model list is refreshed. The runtime still needs to normalize fetched ids through provider-specific capability rules so the UI can detect function calling, reasoning, vision, video, search, and image-output support.

DeepSeek, MiniMax, Moonshot, and Zhipu use provider-specific model fetchers rather than a raw generic list. The fetchers call the shared model parser with provider configs, and the database repository adds read-time-only `settings.extendParams` for fetched models where the remote model table cannot store option-panel settings. This keeps fetched DeepSeek V4 and MiniMax M-series models usable in the model option panel, while Moonshot Kimi K2.7 Code and Kimi K3 remain reasoning-capable without a toggle because the provider forces thinking/preserved reasoning. Fetched Zhipu GLM reasoning models infer `enableReasoning` + `zhipuClearThinking` (plus `zhipuReasoningEffort` for `glm-5.2` and above). Fetched K3 variants receive reasoning, vision, and video capabilities from the Moonshot keyword normalizer when an exact built-in card is unavailable.

## Provider request debug

Moonshot, MiniMax, DeepSeek, Zhipu, and Anthropic-compatible troubleshooting can use provider-specific chat debug flags. In addition to the existing raw payload/stream logs, these flags emit a structured `[provider-debug:request]` summary with hashed endpoint origin/path, path depth, query-key names, upstream route, model, turn shape, tool count/fingerprint, and payload fingerprint. URL credentials, hosts, path segments, query values, authorization secrets, and tool names are omitted:

- `DEBUG_MOONSHOT_CHAT_COMPLETION=1`
- `DEBUG_MINIMAX_CHAT_COMPLETION=1`
- `DEBUG_DEEPSEEK_CHAT_COMPLETION=1`
- `DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION=1`
- `DEBUG_ZHIPU_CHAT_COMPLETION=1`

Use this first for endpoint/path problems such as `url.not_found`, then inspect the full payload/stream logs only if the structured request shape is not enough. Those logs are one-record-per-line JSON: the request logs a `[requestPayload]` marker followed by the entire payload as a single compact JSON line, and streams log `[stream start]` / `[stream finished]` markers with delta chunks merged into one consolidated JSON record of the assembled response (id, model, finish reason, text, reasoning, tool calls, usage) — only chunks of unrecognized shape are logged individually. The full debug logs can include prompt and response content.

## Context export request boundary

The runtime exposes an isolated `onRequestPrepared` callback on chat and
structured-output options. Provider adapters invoke it immediately before the
SDK/client dispatch, after the provider-native semantic request has been built.
The callback receives the request object and logical API mode, but not request
options, credentials, headers, base URLs, abort signals, or transport metadata.

This boundary supports Context Export without changing normal generation. The
OpenAI-compatible factory covers Chat Completions and Responses requests;
Anthropic Messages, Google/Vertex `generateContent`, Azure OpenAI, and Azure AI
invoke the same callback in their provider-specific dispatch paths. DeepSeek,
MiniMax, and Moonshot builders remain upstream of the shared compatible runtime
boundary, so their native request fields are captured after those conversions.

For streamed chat routes, the sanitized snapshot is framed as a dedicated
`context_snapshot` SSE event before the first upstream content event. Browser
direct calls and server routes use the same event contract. A stream that ends
before request preparation closes without waiting for a snapshot. If dispatch
rejects after `onRequestPrepared`, browser-direct and server routes return an
`error` snapshot containing the sanitized prepared request. Structured-output
supervisor captures use the same rule through the capture-aware tRPC procedure:
the snapshot is delivered before the provider error is propagated to supervisor
handling.

The semantic request is intentionally not a byte-level HTTP dump. SDK
serialization, authentication, headers, endpoint selection, and network
transport happen after this callback. The client sanitizes the captured object
before storing it in transient Zustand state; raw snapshots are not logged,
traced, persisted, or written to message metadata. Sanitization redacts
provider-native inline media content in `inlineData.data`, `inline_data.data`,
`source.data`, and `inputAudio.data`, in addition to `data:` URLs. It does not
remove ordinary tool argument fields merely because they are named `data`.
JSON Schema name maps retain their keys so tool contracts are represented
faithfully, while sensitive request fields within schema values remain subject
to recursive sanitization. Browser-direct capture wrapping preserves the
original provider error classification alongside the exported error snapshot.
Capture metadata keeps the selected provider ID separate from the runtime
adapter used to execute the request.

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
- `packages/model-runtime/src/providers/zhipu/index.test.ts`
- `packages/model-runtime/src/providerTestUtils.test.ts`

For changes tied to the OpenAI SDK upgrade path, pay special attention to error-shape assertions and any stream fixtures that depend on Responses annotations or usage payloads.

## Key source references

- `packages/model-runtime/package.json`
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts`
- `packages/model-runtime/src/core/streams/openai/responsesStream.ts`
- `packages/model-runtime/src/core/contextBuilders/anthropic.ts`
- `packages/model-runtime/src/utils/handleOpenAIError.ts`
- `src/server/modules/ModelRuntime/index.ts`
