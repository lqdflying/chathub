# OpenAI-Compatible Cache Matrix

ChatHub exposes cache and Responses-parameter controls for the built-in `openaicompatible` provider because compatible gateways do not agree on one request shape. The settings panel uses an API route radio selector, then applies a separate matrix for cache hints and Responses parameter compatibility.

## Settings Matrix

| Setting | API path | Upstream effect |
| --- | --- | --- |
| API route = Chat Completions | `/v1/chat/completions` | Routes requests to Chat Completions API. |
| API route = Responses API | `/v1/responses` | Routes requests to Responses API. |
| Chat `prompt_cache_key` | `/v1/chat/completions` | Derives a stable `prompt_cache_key` for cache-hit-capable models and sends it in the request body. |
| Chat `Session_id` | `/v1/chat/completions` | Sends the same derived key as the `Session_id` request header. |
| Responses `prompt_cache_key` | `/v1/responses` | Derives and sends `prompt_cache_key` when set to `Auto-generate`. |
| Responses `Session_id` | `/v1/responses` | Sends a derived `Session_id` header, even when `prompt_cache_key` is disabled. |
| Responses `store` | `/v1/responses` | Sends `store: true`, sends `store: false`, or omits `store` when set to Default. |
| Responses `max_tokens` | `/v1/responses` | Custom-only option to send or omit the Chat Completions-style token limit. |
| Responses `max_output_tokens` | `/v1/responses` | Custom-only option to send or omit the Responses-style token limit. |
| Responses `truncation` | `/v1/responses` | Custom-only option to omit, send `auto`, or send `disabled`. |
| Responses `verbosity` | `/v1/responses` | Custom-only option to omit, send `text.verbosity`, send top-level `verbosity`, or send both. |

Preset selection writes the full matrix. Built-in presets keep the matrix hidden; `Custom` expands every cache and Responses-parameter option for provider-probe testing.

## Built-In Presets

| Preset | Route preference | Chat Completions cache | Responses cache | Probe status |
| --- | --- | --- | --- | --- |
| `Prompt key + store` | Responses API | `prompt_cache_key`, no `Session_id` | `prompt_cache_key: derived`, no `Session_id`, `store: true` | Shared built-in mode verified for `pptoken.org` and `apikl.ai`; optional Responses parameter fields are omitted. |

## Runtime Notes

- The matrix is stored under provider config as `openAICompatCache`.
- Responses parameter compatibility is stored under provider config as `openAICompatResponsesParams`.
- `responseStateMode: "provider"` remains a legacy input and normalizes to the `Prompt key + store` preset when no matrix exists.
- Legacy saved `pptoken.org` and `apikl.ai` preset values are accepted and normalized to `Prompt key + store`.
- Runtime-only fields are stripped before upstream request bodies are sent.
- Built-in presets apply their verified Responses parameter behavior. `Custom` applies the expanded parameter matrix exactly, so unknown providers can be tested freely.
- Cache keys are derived from stable prompt parts such as model, system/developer messages, first user message, reasoning effort, and tools.
- The derived key is currently injected only for cache-hit-capable model families recognized by the runtime.

## Debugging Cache Misses

- Start with `DEBUG_OPENAICOMPATIBLE_CACHE=1` on the ChatHub server. It logs redacted request fingerprints, turn/input shapes, tool names/count, cache-key/session-header summaries, and cached-token usage for both Chat Completions and Responses.
- Use `DEBUG_OPENAICOMPATIBLE_CHAT_COMPLETION=1` for full raw Chat Completions request and stream inspection.
- Use `DEBUG_OPENAICOMPATIBLE_RESPONSES=1` for full raw Responses request and stream inspection.
- Full route debug can expose prompt, tool, and file context. Prefer the redacted cache debug when comparing ChatHub sessions with provider-probe or Codex behavior.
- For `Prompt key + store` on Responses, the cache debug should show `promptCacheKey.present:true`, `sessionId.present:false`, `store:true`, and no optional Responses parameter fields. If `promptCacheKey` is absent, the saved config is only partially applying the preset.
- For `Prompt key + store` on Chat Completions, the cache debug should show `promptCacheKey.present:true` and `sessionId.present:false`. Chat `Session_id` remains Custom-only because it can break real multi-turn sessions even when a repeated single-turn probe succeeds.
- Final finding: the previous cache misses were not caused by a strict provider identity difference between `pptoken.org` and `apikl.ai`. The effective shared fix is route-specific cache hints: Chat body `prompt_cache_key`; Responses body `prompt_cache_key + store:true`; no `Session_id`. Intermittent single-round misses can still come from provider-side shard/warmup behavior or request-shape changes.
