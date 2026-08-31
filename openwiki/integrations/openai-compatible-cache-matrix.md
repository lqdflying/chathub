# OpenAI-Compatible Cache Matrix

ChatHub exposes cache and Responses-parameter controls for the built-in `openaicompatible` provider because compatible gateways do not agree on one request shape. The settings panel uses an API route radio selector, then applies a separate matrix for cache hints and Responses parameter compatibility.

## Settings Matrix

| Setting                       | API path               | Upstream effect                                                                                    |
| ----------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| API route = Chat Completions  | `/v1/chat/completions` | Routes requests to Chat Completions API.                                                           |
| API route = Responses API     | `/v1/responses`        | Routes requests to Responses API.                                                                  |
| Chat `prompt_cache_key`       | `/v1/chat/completions` | Derives a stable `prompt_cache_key` for cache-hit-capable models and sends it in the request body. |
| Chat `Session_id`             | `/v1/chat/completions` | Sends the same derived key as the `Session_id` request header.                                     |
| Responses `prompt_cache_key`  | `/v1/responses`        | Derives and sends `prompt_cache_key` when set to `Auto-generate`.                                  |
| Responses `Session_id`        | `/v1/responses`        | Sends a derived `Session_id` header, even when `prompt_cache_key` is disabled.                     |
| Responses `store`             | `/v1/responses`        | Sends `store: true`, sends `store: false`, or omits `store` when set to Default.                   |
| Responses `max_tokens`        | `/v1/responses`        | Custom-only option to send or omit the Chat Completions-style token limit.                         |
| Responses `max_output_tokens` | `/v1/responses`        | Custom-only option to send or omit the Responses-style token limit.                                |
| Responses `truncation`        | `/v1/responses`        | Custom-only option to omit, send `auto`, or send `disabled`.                                       |
| Responses `verbosity`         | `/v1/responses`        | Custom-only option to omit, send `text.verbosity`, send top-level `verbosity`, or send both.       |

Preset selection writes the full matrix. Built-in presets keep the matrix hidden; `Custom` expands every cache and Responses-parameter option for provider-probe testing.

## Built-In Presets

| Preset               | Route preference | Chat Completions cache              | Responses cache                                             | Probe status                                                                                                     |
| -------------------- | ---------------- | ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Prompt key + store` | Responses API    | `prompt_cache_key`, no `Session_id` | `prompt_cache_key: derived`, no `Session_id`, `store: true` | Shared built-in mode verified for `pptoken.org` and `apikl.ai`; optional Responses parameter fields are omitted. |

## Runtime Notes

- The matrix is stored under provider config as `openAICompatCache`.
- Responses parameter compatibility is stored under provider config as `openAICompatResponsesParams`.
- `responseStateMode: "provider"` remains a legacy input and normalizes to the `Prompt key + store` preset when no matrix exists.
- Legacy saved `pptoken.org` and `apikl.ai` preset values are accepted and normalized to `Prompt key + store`.
- Runtime-only fields are stripped before upstream request bodies are sent.
- Built-in presets apply their verified Responses parameter behavior. `Custom` applies the expanded parameter matrix exactly, so unknown providers can be tested freely.
- Cache keys are derived from the effective route request. In Responses mode that includes the nested `reasoning` object (with model-option-panel effort applied) and converted Responses tool schemas, so changing effort or tools changes the key.
- Reasoning effort is not part of `openAICompatResponsesParams`: the model option panel owns the value, Chat Completions sends top-level `reasoning_effort`, and Responses sends nested `reasoning.effort`. Legacy provider-level shape selectors are ignored and stripped.
- When the matrix explicitly enables a cache hint (`prompt_cache_key` or `Session_id`), the key is derived for **any** model. The gpt-5/codex model-family allowlist applies only to the legacy implicit `responseStateMode: "provider"` (no-matrix) path.
- The factory `store ?? true` fallback also applies only to that no-matrix legacy path — it matches the `Prompt key + store` normalization. With a saved matrix, `store: default` correctly omits the field.
- Responses input conversion is role-aware: user/system/developer replay may contain `input_text` and `input_image` parts, tool outputs become `function_call_output`, and assistant replay is serialized as plain string `content` unless complete Responses output items are retained. Assistant history must not be emitted as assistant `input_text` arrays because compatible Responses endpoints validate assistant arrays as model output content.
- Historical assistant `reasoning` is never serialized into Responses `input` for the `openaicompatible` provider (mirroring the Chat Completions `reasoning_content` rule), keeping the cached prefix stable.
- The history limit is anchored to the latest user message. Automatic assistant, MCP, and built-in tool messages extend that active turn without moving its starting boundary; the window re-anchors on the next user message. A tool-heavy turn can therefore temporarily exceed `historyCount`.
- The Chat and Responses routes derive different `compat_cc_` keys for the same conversation (different serializations), so switching the API route mid-session starts a cold cache — expected behavior.

## Debugging Cache Misses

- Start with `DEBUG_OPENAICOMPATIBLE_CACHE=1` on the ChatHub server. It uses the shared cache schema while preserving the `openai-compatible-cache-debug` namespace. It logs provider/runtime family, API/stream mode, server-derived cache policy booleans, input/tool counts, keyed request/response correlations, continuation metadata, and normalized cache counters for Chat Completions and Responses.
- Use `DEBUG_OPENAICOMPATIBLE_CHAT_COMPLETION=1` for full raw Chat Completions request and stream inspection.
- Use `DEBUG_OPENAICOMPATIBLE_RESPONSES=1` for full raw Responses request and stream inspection.
- Full route debug can expose prompt, tool, and file context. Prefer the redacted cache debug when comparing ChatHub sessions with provider-probe or Codex behavior.
- For `Prompt key + store` on Responses, the cache debug should show `promptCacheKey.present:true`, `sessionId.present:false`, `store:true`, and no optional Responses parameter fields. If `promptCacheKey` is absent, the saved config is only partially applying the preset.
- For `Prompt key + store` on Chat Completions, the cache debug should show `promptCacheKey.present:true` and `sessionId.present:false`. Chat `Session_id` remains Custom-only because it can break real multi-turn sessions even when a repeated single-turn probe succeeds.
- When a tool continuation misses despite an unchanged cache key and tool fingerprint, compare `turnShape`. The continuation should extend the prior request; if its first retained entries disappear after tool results, the history window moved and invalidated the byte-identical prefix.
- Tool continuations carry a privacy-safe `toolCache` summary in cache diagnostics. It includes the settled input item count, tool-call count, shared 16-hex tool-call set hash, effective route cache policy, and bounded result-shape summaries. The summary contains no raw tool-call IDs, names, arguments, URLs, prompts, or result content.
- A cache request record and its usage records share a 32-hex keyed `requestHash`; usage records also include a stable 32-hex keyed `responseHash` for repeated observations of the same provider response. Tool completion records use the shared 16-hex tool-call set hash and retain each tool's own `diagnosticId`.
- `debugToolCache` is an internal stream envelope field. The OpenAI-compatible factory consumes it for diagnostics and strips it from both Chat Completions and Responses requests. Azure adapters strip it as a defense-in-depth boundary, and completion telemetry is isolated and fire-and-forget so diagnostics cannot block continuation.
- Final finding: the previous cache misses were not caused by a strict provider identity difference between `pptoken.org` and `apikl.ai`. The effective shared fix is route-specific cache hints: Chat body `prompt_cache_key`; Responses body `prompt_cache_key + store:true`; no `Session_id`. Intermittent single-round misses can still come from provider-side shard/warmup behavior or request-shape changes.

## Cross-Provider Cache Diagnostics

Cache-only switches are separate from raw `DEBUG_*_CHAT_COMPLETION` transport
debugging and are suitable for production troubleshooting:

| Provider path             | Safe switch                         | Runtime cache behavior                                                                              |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Native OpenAI             | `DEBUG_OPENAI_CACHE=1`              | Automatic caching; eligible GPT-5.6-or-later requests receive a server-derived `prompt_cache_key`.  |
| Azure OpenAI              | `DEBUG_AZURE_CACHE=1`               | Automatic caching; eligible GPT-5.6-or-later requests receive the same trusted-key strategy.        |
| OpenAI-compatible         | `DEBUG_OPENAICOMPATIBLE_CACHE=1`    | Existing provider matrix (`prompt_cache_key`, `Session_id`, `store`) remains authoritative.         |
| Moonshot/Kimi             | `DEBUG_MOONSHOT_CACHE=1`            | Automatic provider caching; observability only, no invented request fields.                         |
| DeepSeek                  | `DEBUG_DEEPSEEK_CACHE=1`            | Automatic provider caching with supported hit/miss token telemetry.                                 |
| MiniMax OpenAI API        | `DEBUG_MINIMAX_CACHE=1`             | Passive provider caching; observability only.                                                       |
| Anthropic                 | `DEBUG_ANTHROPIC_CACHE=1`           | Existing `cache_control` breakpoint count and effective TTL are reported; no new markers are added. |
| Anthropic-compatible      | `DEBUG_ANTHROPICCOMPATIBLE_CACHE=1` | Existing configured compatibility behavior only.                                                    |
| Google Gemini / Vertex AI | `DEBUG_GOOGLE_CACHE=1`              | Automatic cache telemetry where usage reports it; no cached-content resources are created.          |
| Azure AI Inference        | `DEBUG_AZUREAI_CACHE=1`             | Reported as `unobservable`; no cache counters are fabricated.                                       |
| Zhipu (GLM)               | `DEBUG_ZHIPU_CACHE=1`               | Implicit prefix caching; `usage.prompt_tokens_details.cached_tokens` reported; no request fields.   |
| Xiaomi MiMo               | `DEBUG_MIMO_CACHE=1`                | `usage.prompt_tokens_details.cached_tokens` reported; no request cache fields.                      |

All switches require `KEY_VAULTS_SECRET` or `NEXT_AUTH_SECRET` so request,
response, model, and native prompt-cache correlations use deployment-keyed
HMAC-SHA-256 fingerprints. Without either secret, cache diagnostics remain
disabled and an enabled request emits a `model-cache-debug:disabled` warning.

Non-OpenAI-compatible providers use
`[model-cache-debug:<request|usage|usage_missing|terminal_error>] {json}`.
OpenAI-compatible retains
`[openai-compatible-cache-debug:<event>] {json}` for query compatibility.
Every event is reconstructed from an explicit allowlist. It never contains raw
prompts, model IDs, application/provider response IDs, cache keys, tool
names/arguments/results, schemas, URLs, headers, credentials, or response
content.

Normalized `cacheStatus` values are:

- `hit`: cache-read tokens are greater than zero and no miss tokens are reported.
- `mixed`: both cache-read and cache-miss tokens are greater than zero.
- `write`: cache-write tokens are greater than zero without a read hit.
- `miss`: the provider explicitly reported cache counters and all read/write counters are zero.
- `not_reported`: cache support exists or may exist, but the provider omitted cache telemetry.
- `unsupported`: the runtime explicitly cannot report this cache contract.

A reported zero is meaningful and remains zero. An absent counter remains
absent; ChatHub never converts missing telemetry into a miss. `usage_missing`
uses `provider_omitted_usage`, `request_failed`, or `runtime_unsupported` to
make the unavailable case explicit.

DeepSeek maps its native `prompt_cache_hit_tokens` and
`prompt_cache_miss_tokens` fields into the shared counters, so it is classified
as `supported`. Anthropic request events report `cacheControlBreakpointCount`
from the final provider payload and `cacheTTL` as `5m`, `1h`, or `mixed`; an
ephemeral marker without an explicit TTL uses Anthropic's documented `5m`
default.

Exactly one terminal cache event is emitted per request path. Successful JSON
and streaming responses terminate with `usage` or `usage_missing`; provider
rejections, stream protocol errors, and downstream cancellation terminate with
`terminal_error`. Cancellation still propagates to the owned upstream stream.

Native OpenAI and Azure OpenAI ignore client-supplied `prompt_cache_key`.
ChatHub derives an opaque `ch_<32-hex>` key from authenticated user scope plus
topic/session context, with a content-derived fallback when no conversation
identifier exists. Adapters model-gate the field and omit it for ineligible
models. Raw keys never appear in logs.
