# OpenAI-Compatible Cache Matrix

ChatHub exposes cache controls for the built-in `openaicompatible` provider because compatible gateways do not agree on one cache hint shape. The settings panel keeps `Use Responses API Specification` as the route selector, then applies a separate cache matrix for Chat Completions and Responses.

## Settings Matrix

| Setting | API path | Upstream effect |
| --- | --- | --- |
| Chat `prompt_cache_key` | `/v1/chat/completions` | Derives a stable `prompt_cache_key` for cache-hit-capable models and sends it in the request body. |
| Chat `Session_id` | `/v1/chat/completions` | Sends the same derived key as the `Session_id` request header. |
| Responses `prompt_cache_key` | `/v1/responses` | Derives and sends `prompt_cache_key` when set to `Auto-generate`. |
| Responses `Session_id` | `/v1/responses` | Sends a derived `Session_id` header, even when `prompt_cache_key` is disabled. |
| Responses `store` | `/v1/responses` | Sends `store: true`, `store: false`, or leaves the runtime/provider default when set to Default. |

Preset selection writes the full matrix. Any manual edit changes the preset to `Custom`.

## Confirmed Presets

| Preset | Route preference | Chat Completions cache | Responses cache | Probe status |
| --- | --- | --- | --- | --- |
| `pptoken.org` | Responses API | Chat cache off/unverified | `prompt_cache_key: derived`, no `Session_id`, `store: true` | Matches the previous ChatHub Responses state-cache behavior. |
| `apikl.ai` | Responses API | `prompt_cache_key` + `Session_id` | `prompt_cache_key: derived`, no `Session_id`, `store: false` | User-confirmed cache hits; Chat observed intermittently, Responses observed stably in the latest six-round probes. |

## Runtime Notes

- The matrix is stored under provider config as `openAICompatCache`.
- `responseStateMode: "provider"` remains a legacy input and normalizes to the `pptoken.org` Responses preset when no matrix exists.
- Runtime-only fields are stripped before upstream request bodies are sent.
- Cache keys are derived from stable prompt parts such as model, system/developer messages, first user message, reasoning effort, and tools.
- The derived key is currently injected only for cache-hit-capable model families recognized by the runtime.
