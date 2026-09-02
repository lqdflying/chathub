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

### Responses input sanitation and legacy function calls

`convertOpenAIResponseInputs`
(`packages/model-runtime/src/core/contextBuilders/openai.ts`) translates Chat
Completions history into Responses `input` items. Two guards keep the final
Responses request well-formed:

- Fully-empty textual items (an `EasyInputMessage` whose role is
  `user`/`assistant`/`system`/`developer` and whose content is an empty string
  or an empty part list) are dropped after conversion, because strict providers
  reject a Responses request that contains an empty message. Items carrying
  `function_call`, `function_call_output`, or reasoning are never dropped.
- Legacy Chat Completions function calling (an assistant `function_call` plus
  `function` result messages, which predate `tool_calls` and carry no call ids)
  is translated into paired Responses `function_call` / `function_call_output`
  items sharing a deterministic call id (`legacy_fc_N`, stable for the same
  message sequence so prompt-cache prefixes are unaffected). Without this, a
  legacy turn would serialize as an empty assistant item followed by a `user`
  item, losing the call/result pairing.

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

`zhipu` is a first-class OpenAI-compatible provider built with the shared factory. Its default ChatHub route is the China endpoint `https://open.bigmodel.cn/api/paas/v4`; deployments targeting the international `https://api.z.ai/api/paas/v4/` endpoint must configure the base URL explicitly. `glm-5.2` is the enabled default model with a `1_048_576`-token context window. Per the Zhipu API ref, the GLM-5.2/5.1/5/5-turbo/4.7/4.6 text models support 128K (131_072) max output, GLM-4.5 supports 96K (98_304), and GLM-5V-Turbo supports 128K (131_072); the shipped `maxOutput` values match.

The Zhipu adapter (`packages/model-runtime/src/providers/zhipu/index.ts`) is a single `buildZhipuPayload` function plus the factory registration. It translates the shared `ChatStreamPayload` into Zhipu's request body:

- **Gateway-safe thinking object** — the adapter never sends the literal `thinking.type: "enabled"` because some OpenAI-compatible GLM gateways (LiteLLM → vLLM) hard-reject that string with HTTP 400 (probe-verified 2026-08-06), while the official API defaults `thinking.type` to `enabled` anyway (https://docs.z.ai/guides/capabilities/thinking). The rejection is **path- and backend-dependent**: the same gateway returned 400 for `{type:"enabled"}` on plain (no-tools) requests but 200 on tool requests in one probe round, and 400 for both in an earlier round (its backend pool changed between rounds) — so the contract avoids the literal entirely rather than relying on observed leniency. The wire translation is: thinking **ON** → omit the `thinking` field entirely (behavior-identical upstream); thinking **OFF** → `{ type: 'disabled' }` (accepted everywhere); **Preserved Thinking** → `{ clear_thinking: false }` with **no** `type` key (type defaults to enabled upstream; gateways accept the type-less object, verified plain + tools + a 2-turn replayed-`reasoning_content` conversation). Anthropic-style `budget_tokens` and Moonshot-style `keep` from the service layer are always stripped. GLM-4.7 forces thinking per Zhipu docs ("GLM-4.7 will think compulsorily"), so it ships **no** `enableReasoning` toggle — but `clear_thinking` is a documented GLM-4.5+ capability orthogonal to forced thinking, so `glm-4.7` ships `zhipuPreservedThinking` only; the service layer has a dedicated zhipu-only branch that attaches `thinking: { type: 'enabled', clear_thinking: false }` when Preserved Thinking is on, which the runtime then translates to the type-less form.
- **reasoning_effort** — forwarded only on `glm-5.2` and above, and only when thinking is enabled. The chat service maps the UI `skip` value to the API **`none`** value (NOT the documented-equivalent `minimal` — the same gateways reject `minimal` with HTTP 400; `none` is probe-verified to skip thinking); the runtime forwards the value verbatim.
- **do_sample** — set to `false` (greedy decoding) when `temperature === 0`; sampling params are then omitted because Zhipu ignores them when `do_sample` is false. Note: the chat service strips `temperature`/`top_p` from app-level payloads before the runtime, so this branch is only exercisable by direct consumers of the model-runtime package.
- **tool_stream** — never sent. Gateway backends reject it intermittently with HTTP 400 (`Extra inputs are not permitted, field: 'tool_stream'`) and the backend pool rotates between lenient and strict instances, so no model-id gating can be safe. The trade-off is accepted: tool-call arguments arrive as one chunk instead of being incrementally streamed (on native Zhipu too).
- **tool_choice** — coerced to `'auto'` when tools are present; Zhipu rejects `none`, `required`, and specific-function selection.
- **web_search tool** — injected into the `tools` array when `enabledSearch` is set, using `{ type: 'web_search', web_search: { search_engine: 'search_pro_jina', enable: true } }`. Reachability requires the model card to declare `settings.searchImpl: 'params'`; the 7 shipped text cards (`glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`, `glm-4.5`) set it, `glm-5v-turbo` does not (the Vision request schema has no `web_search` tool).
- **Thinking + search/JSON no longer forces disabled** — on `glm-5.2`, `enabledSearch` or `response_format: json_object` previously forced the wire thinking object to `{ type: 'disabled' }`. That exclusion was never documented by Zhipu (verified across the chat-completion API ref, thinking guide, thinking-mode guide, and web-search guide as of 2026-08-05) and is unproven on native — treated as a myth. It was also cache-hostile: the varying body broke the byte-stable prefix that GLM implicit caching matches on. The field is now omitted like normal thinking-ON; the gateway reasons regardless, and on native Zhipu thinking is default-on anyway.
- **Preserved Thinking history handling** — when Preserved Thinking is on (`clear_thinking: false` on the wire), the adapter keeps the internal `reasoning` field and any bare `reasoning_content` on assistant messages so the shared `convertOpenAIMessages` context builder replays them as `reasoning_content`; otherwise it strips **both** to match Zhipu's default behavior of discarding historical thinking (the shared builder checks `reasoning_content` first, then `reasoning.content`, so both shapes must be stripped on the clear path).

The shared `OpenAIStream` already extracts Zhipu's `delta.reasoning_content` (same field as DeepSeek/Moonshot) and Zhipu's `web_search` citations, so no custom stream handler is required.

Zhipu GLM-5.x/4.x use **implicit prefix caching** (https://docs.z.ai/guides/capabilities/cache): caching is automatic, requires no request parameter, and reports hits in `usage.prompt_tokens_details.cached_tokens`. The shared stream/usage converters already surface this as `inputCachedTokens`. Because matching is by byte-stable prefix ("minor formatting differences may affect cache effectiveness"), `PlaceholderVariablesProcessor` treats `zhipu` as cache-prefix-sensitive and skips volatile generators in system messages (see `CACHE_PREFIX_SENSITIVE_PROVIDERS`). Cache observability uses `DEBUG_ZHIPU_CACHE=1` under the shared `model-cache-debug` namespace; the provider is declared `cacheSupport: 'supported'`.

The default model list ships 8 GLM cards (`glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`, `glm-4.5`, `glm-5v-turbo`). Only `glm-5.2` carries `zhipuReasoningEffort` in its `extendParams`; `glm-4.7` carries **only** `zhipuPreservedThinking` (thinking is forced, so no `enableReasoning` toggle, but `clear_thinking` is a documented GLM-4.5+ capability); the rest carry `enableReasoning` and `zhipuPreservedThinking`. Fetched Zhipu models receive inferred `extendParams` at read time in `packages/database/src/repositories/aiInfra/index.ts` because the remote model table cannot persist `settings.extendParams`; fetched `glm-4.7` ids get `['zhipuPreservedThinking']` only, matching the shipped card.

### Xiaomi MiMo

`mimo` is a first-class OpenAI Chat Completions provider (`packages/model-runtime/src/providers/mimo/index.ts`). Default base URL is `https://api.xiaomimimo.com/v1`. Auth is Bearer `MIMO_API_KEY`. Token Plan uses `MIMO_PROXY_URL=https://token-plan-cn.xiaomimimo.com/v1` plus a `tp-...` key. `buildMimoPayload` is the single request shaper:

- **thinking** — always send `{ type: 'enabled' | 'disabled' }` when the gear toggle is present. Vendor default is enabled; ChatHub off sends `disabled`. While thinking is on, omit `temperature` and `top_p` (the API forces `1.0` / `0.95`); still forward `frequency_penalty` and `presence_penalty`.
- **max_completion_tokens** — official Chat Completions field; ChatHub maps `max_tokens` (including the 256-token connection probe) to it.
- **tool_choice** — coerced to `auto` (the only documented value).
- **structured output / generateObject** — Xiaomi documents `response_format.type: json_object` plus an explicit JSON instruction in messages ([structured output](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)). ChatHub still advertises `structuredOutput` on both cards. `shapeMimoGenerateObjectRequest` omits `user`, rewrites `json_schema` to `json_object` with the schema in messages, and **translates the tools overload into the same JSON mode** (`{ tool_calls: [{ name, arguments }] }`) because Xiaomi only documents `tool_choice: auto` and a text reply is otherwise valid. The factory parses that JSON (or native `tool_calls`) and **validates names plus required arguments against the offered tools**. Xiaomi JSON mode guarantees syntax only, not schema compliance. Empty, malformed, invented, or mixed-invalid selections throw, so the group supervisor cannot finalize success from a no-op JSON object. `wait_for_user_input` remains the valid pause with zero child agents. Ordinary chat still coerces `tool_choice` to `auto`.
- **web_search** — on pay-as-you-go (`api.xiaomimimo.com`), when `enabledSearch` is set, append `{ type: 'web_search' }` to `tools`. Do not send `force_search` by default. Do not auto-disable thinking for search/tools. On Token Plan hosts (`token-plan*.xiaomimimo.com`) omit native `{ type: web_search }` (and strip it if already present) because Token Plan returns `400` `webSearchEnabled is false` until Xiaomi Console → Plugin Management enables Web Search; function/MCP tools still go through. Search routing forces `useModelSearch=false` for Token Plan whether the host comes from Settings `baseURL` or container `MIMO_PROXY_URL` (`serverConfig.mimoTokenPlanEnv` is a boolean hostname-class hint, not the URL). The search panel hides the native toggle in both cases. Pay-as-you-go native search stays available when Settings points at `api.xiaomimimo.com`.
- **error.param** — Token Plan 400 bodies use `message: Param Incorrect` plus `error.param` for the real reason. `resolveIteratorErrorMessage` folds `param` into the stream error message (UI). `execute_settled` logs only `errorParamClass` (known Xiaomi operational enums) and `errorParamHash`; raw `error.param` is not written to the PII-safe generation log.
- **reasoning_content** — when thinking is on, assistant tool-call turns must pass historical `reasoning_content`. Map ChatHub `message.reasoning.content` when present; inject `''` only when neither that nor a usable bare `reasoning_content` exists. An empty or null bare field must not overwrite stored reasoning.
- **Fetch** — `client.models.list()` plus `MODEL_LIST_CONFIGS.mimo`; drop tts/asr/voiceclone/voicedesign ids. `mimo-v2.5-pro` is text; exact `mimo-v2.5` gets vision/video. Fetched ids infer `enableReasoning` at read time.
- **Cache** — `cacheSupport: 'supported'` via `usage.prompt_tokens_details.cached_tokens`. Debug: `DEBUG_MIMO_CACHE=1`. Not in `CACHE_PREFIX_SENSITIVE_PROVIDERS`.
- **UI brand mark** — ChatHub provider id is `mimo`; `@lobehub/icons` v3+ uses `xiaomimimo`. While ChatHub pins icons 2.x, Settings/model pickers load vendored assets from `public/icons/providers/mimo*` via `resolveProviderLogoUrl` / `ProviderBrandIcon`.
- **Request whitelist** — `buildMimoPayload` emits only documented Chat Completions fields (Token Plan has returned `400 Invalid request parameters` for ChatHub-internal keys). Also `excludeUsage` / `noUserId` so `stream_options` and `user` are not sent. Temperature is clamped to `[0, 1.5]` and `top_p` to `[0.01, 1.0]`. Omit `frequency_penalty` / `presence_penalty` unless they are numbers — JSON `null` is a Token Plan 400 with empty `param`. A connectivity check can still pass while chat fails: the check body has no tools and no out-of-range sampling. Other Token Plan 400s include temperature `> 1.5` (`param=temperature must be within [0, 1.5]`) and native `web_search` without the plugin.

### MiniMax

`minimax` is a first-class OpenAI-compatible Chat Completions provider (`packages/model-runtime/src/providers/minimax/index.ts`). Default base URL is `https://api.minimax.io/v1`. Auth is Bearer `MINIMAX_API_KEY`. On this maintainer host, live probes use **`MINIMAX_API_KEY`** and **`MINIMAX_PROXY_URL`** from `~/.bashrc` (same names as ChatHub env; see `.cursor/rules/minimax-live-probe.mdc`). `buildMinimaxOpenAIChatPayload` is the request shaper:

- **reasoning_split** — output-format flag only (does **not** enable/disable thinking); defaults to `true` unless the payload sets `false`.
- **thinking** — MiniMax-M3 Chat Completions field: omit/`adaptive` keeps thinking on; `{ type: "disabled" }` skips thinking. Connectivity Check sends `thinking: { type: "disabled" }`, `stream: false`, and leaves `reasoning_split` at the chat default. Safari iOS previously cleared the Check spinner with no pass/fail even when Axiom showed `finishReason: stop` and hello text — Checker settles WebKit `Load failed` with text or reasoning-only output as pass (via `onAbort`, not shared `onErrorHandle`), keeps the component mounted during config refresh, and always shows pass or fail. Empty intentional aborts in shared `fetchSSE` remain abort-only so chat Stop-before-first-token is not turned into a provider error. M2.x cannot disable thinking. Official: [Chat Completions](https://platform.minimax.io/docs/api-reference/text-chat-openai).
- **Vision `detail`** — MiniMax documents `image_url.detail` / `video_url.detail` as `low` | `default` | `high` (default `default`). ChatHub's message processor stamps OpenAI `detail: auto` on every attached image. MiniMax rejects that with HTTP 400 `invalid params, invalid image detail: auto (2013)`. The adapter keeps `low` / `default` / `high` and **omits** `auto` and any other value so MiniMax applies `default`. Live-probed 2026-09-02: hello, stream, tools, and images without `auto` succeed; the same image with `detail: auto` fails in ~300ms. Official schema: [Chat Completions](https://platform.minimax.io/docs/api-reference/text-chat-openai). Error `2013`: [error codes](https://platform.minimaxi.com/docs/api-reference/errorcode.md).
- **max_tokens** — falls back to the model-bank `maxOutput` (32_768 on MiniMax-M3) when omitted.

### Provider brand icons (all providers)

Standing policy: **always vendor brand marks into the repo** for first-class providers. Do not ship a letter fallback waiting on a CDN or an `@lobehub/icons` major bump. Preferred layout: `public/icons/providers/<id>.*` plus optional inline mono SVG for `currentColor` / dark mode; wire through `ProviderBrandIcon` / `ModelBrandIcon`. Agent rule: **`.cursor/rules/provider-icons.mdc`**.

Responses API and Anthropic Messages exist on the Xiaomi platform but are out of scope for this adapter.

## Model fetch normalization

Providers that expose `/models` can return new model ids before ChatHub's built-in model list is refreshed. The runtime still needs to normalize fetched ids through provider-specific capability rules so the UI can detect function calling, reasoning, vision, video, search, and image-output support.

DeepSeek, MiniMax, Moonshot, Xiaomi MiMo, and Zhipu use provider-specific model fetchers rather than a raw generic list. The fetchers call the shared model parser with provider configs, and the database repository adds read-time-only `settings.extendParams` for fetched models where the remote model table cannot store option-panel settings. This keeps fetched DeepSeek V4, MiniMax M-series, and Xiaomi MiMo V2.5 models usable in the model option panel, while Moonshot Kimi K2.7 Code and Kimi K3 remain reasoning-capable without a toggle because the provider forces thinking/preserved reasoning. Fetched Zhipu GLM reasoning models infer `enableReasoning` + `zhipuPreservedThinking` (plus `zhipuReasoningEffort` for `glm-5.2` and above); fetched `glm-4.7` ids get `zhipuPreservedThinking` only (thinking forced, no reasoning toggle, but `clear_thinking` is a documented GLM-4.5+ capability). Fetched K3 variants receive reasoning, vision, and video capabilities from the Moonshot keyword normalizer when an exact built-in card is unavailable.

## Provider request debug

Moonshot, MiniMax, DeepSeek, Xiaomi MiMo, Zhipu, and Anthropic-compatible troubleshooting can use provider-specific chat debug flags. In addition to the existing raw payload/stream logs, these flags emit a structured `[provider-debug:request]` summary with hashed endpoint origin/path, path depth, query-key names, upstream route, model, turn shape, tool count/fingerprint, and payload fingerprint. URL credentials, hosts, path segments, query values, authorization secrets, and tool names are omitted:

- `DEBUG_MOONSHOT_CHAT_COMPLETION=1`
- `DEBUG_MINIMAX_CHAT_COMPLETION=1`
- `DEBUG_DEEPSEEK_CHAT_COMPLETION=1`
- `DEBUG_MIMO_CHAT_COMPLETION=1`
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

Durable chat generation reuses this runtime from Graphile Worker. See
[Durable conversation generation](durable-conversation-generation.md).
