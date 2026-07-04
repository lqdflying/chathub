# Backend Cache Mechanisms

Use this reference when the provider appears to sit behind new-api, CLIProxyAPI, sub2api, or a similar OpenAI-compatible proxy.

## QuantumNous/new-api

Relevant upstream files:

- `setting/ratio_setting/cache_ratio.go`
- `setting/ratio_setting/exposed_cache.go`
- `relay/channel/openai/usage.go`
- `dto/openai_response.go`

Observed behavior:

- Billing has separate cache-read and cache-creation ratios. Defaults are model-family specific, for example lower read ratios for GPT-5, Claude, DeepSeek, and GPT-4.1 families.
- Cache-hit detection is mostly response-usage driven. The proxy normalizes several provider-specific fields into OpenAI-style usage:
  - `usage.prompt_tokens_details.cached_tokens`
  - `usage.input_tokens_details.cached_tokens`
  - `usage.cached_tokens`
  - `usage.prompt_cache_hit_tokens`
  - `choices[].usage.cached_tokens`
  - `timings.cache_n`
- Claude-style cache creation/read fields can also appear in usage payloads.

Probe implication:

- Treat many usage field names as equivalent cache-read evidence.
- Check cache fields on both `/responses` and `/chat/completions`; some gateways expose cached-token accounting on only one endpoint family.
- A cache ratio setting alone does not prove upstream reuse. Ask the user to confirm vendor dashboard/logs when usage fields and billed cache hits disagree.

## router-for-me/CLIProxyAPI

Relevant upstream files:

- `internal/runtime/executor/helps/cache_helpers.go`
- `internal/runtime/executor/helps/session_id_cache.go`
- `internal/runtime/executor/helps/user_id_cache.go`
- `internal/runtime/executor/helps/usage_helpers.go`
- `internal/runtime/executor/codex_executor.go`

Observed behavior:

- Codex prompt-cache keys are stable for roughly one hour.
- `cacheHelper` sends `prompt_cache_key` in the body and `Session_id` in headers when a cache ID exists.
- For OpenAI Responses source payloads, user-provided `prompt_cache_key` is preserved.
- For OpenAI Chat source payloads, the proxy can derive a stable cache ID from the API key.
- `previous_response_id` can be removed before upstream forwarding, so a direct previous-response probe can fail even when prompt-cache-key behavior works.
- Usage parsing recognizes OpenAI cached-token fields, Claude `cache_read_input_tokens` / `cache_creation_input_tokens`, and Gemini `cachedContentTokenCount`.

Probe implication:

- Test `--strategy prompt-key-session-header` before plain prompt-cache key strategies.
- For Chat Completions, test `--strategy chat-session-header` after Responses mode.
- Report Responses and Chat Completions cache outcomes separately because CLIProxy-style routing can derive different cache IDs for each source mode.
- Do not conclude cache is unsupported only because `previous_response_id` fails.

## Wei-Shaw/sub2api

Relevant upstream files:

- `backend/internal/service/openai_compat_prompt_cache_key.go`
- `backend/internal/service/gateway_cached_tokens_test.go`
- `backend/internal/service/force_cache_billing_test.go`
- `backend/internal/service/gateway_messages_cache.go`
- `backend/internal/service/usage_billing.go`

Observed behavior:

- OpenAI-compatible prompt-cache keys can be auto-derived for model names containing GPT-5 or Codex. The key uses stable request parts such as model, reasoning effort, tools/functions, system messages, and the first user message.
- Anthropic-compatible cache keys can be derived from `cache_control` breakpoints, with stable breakpoints injected on message content when configured.
- Kimi-style `usage.cached_tokens` can be reconciled into Claude-style `cache_read_input_tokens`.
- A force-cache-billing path can move input tokens into cache-read tokens for billing purposes.

Probe implication:

- Test `--strategy implicit-derived-key` to detect backend-side key derivation.
- Keep the model name, reasoning effort, tools, system prompt, and first user turn stable across rounds.
- Run Chat Completions cache probes too; a sub2api-like gateway may derive or rewrite cache hints differently for OpenAI-compatible chat versus Responses-style requests.
- If cache-read fields appear suspiciously equal to all input tokens, treat it as possible proxy billing rewrite until the dashboard confirms a real upstream hit.
- Test `cache-control-content-blocks` only as a late optional probe because strict OpenAI-compatible gateways may reject Anthropic `cache_control` fields.

## Cache-Hit Solution Summary

Prefer this enablement order for ChatHub OpenAI-compatible providers:

1. Configure the provider base URL with `/v1`.
2. Use Responses mode only when `/responses` accepts OpenAI Responses request shape and stream events.
3. Enable ChatHub response-state cache hints when the model id is GPT/Codex-like and the provider accepts `store:true` plus `prompt_cache_key`.
4. For CLIProxy-like backends, add or preserve a stable `Session_id` header alongside `prompt_cache_key` if ChatHub runtime support is added.
5. For sub2api-like backends, keep the cache seed stable: model id, reasoning effort, tool definitions, system prompt, and first user message.
6. For Anthropic-style cache backends, use Anthropic-compatible runtime semantics and stable `cache_control` breakpoints instead of forcing those fields through OpenAI-compatible mode.
7. Test `/chat/completions` independently with repeated stable prompts, `Session_id`, and optional chat `prompt_cache_key` because chat-route cache support can differ from `/responses`.
8. Parse cache-read evidence from OpenAI, Claude, Gemini, and generic proxy usage fields, then confirm billing with the vendor dashboard.

Current ChatHub setting presets:

- `pptoken.org`: Responses API on; Chat Completions cache hints off; Responses uses derived `prompt_cache_key`, no `Session_id`, and `store:true`.
- `apikl.ai`: Responses API on; Chat Completions uses derived `prompt_cache_key` plus `Session_id`; Responses uses derived `prompt_cache_key`, no `Session_id`, and `store:false`.
- `Custom`: use when a probe confirms another combination from the matrix. Manual setting edits should be reported as the exact Chat/Responses fields, not only as "cache enabled."
