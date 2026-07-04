---
name: chathub-provider-probe
description: Probe and diagnose ChatHub OpenAI-compatible providers using PROBE_OPENAICOMPATIBLE_API_KEY and PROBE_OPENAICOMPATIBLE_PROXY_URL. Use when the user asks to verify whether a custom OpenAI-compatible key/base URL works with ChatHub, compare Chat Completions vs Responses API behavior, identify parameter discrepancies with the repo's current OpenAI-compatible runtime, or interactively test prompt-cache/cache-hit behavior for both /responses and /chat/completions across multiple simulated chat rounds.
---

# ChatHub Provider Probe

## Workflow

Use this skill to run live, low-cost API simulations against a ChatHub OpenAI-compatible provider. Never print the API key. Treat the key as sensitive and remind the user to rotate it if they pasted it in chat.

1. Confirm the environment variables exist:
   - `PROBE_OPENAICOMPATIBLE_API_KEY`
   - `PROBE_OPENAICOMPATIBLE_PROXY_URL`, expected to include `/v1`
   - Optional: `PROBE_OPENAICOMPATIBLE_MODEL`, default `gpt-5.5`
   Do not use the app's normal ChatHub provider env vars for this skill; these `PROBE_*` vars are intentionally dedicated to live provider diagnostics.
2. Run the baseline probe:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase baseline
   ```
3. Run the parameter compatibility probe:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase params
   ```
4. Compare results with ChatHub's current runtime behavior. Read `references/chathub-openai-compatible-runtime.md` when interpreting discrepancies.
5. For cache-hit behavior, read `references/backend-cache-mechanisms.md` before choosing the next cache strategy.
6. For cache-hit testing, run one bounded cache round, then stop for user/dashboard confirmation. Test both `/responses` and `/chat/completions` in the same round unless the user explicitly asks for one endpoint only:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --runs 6
   ```
   Summarize `cacheSummary.responses`, `cacheSummary.chatCompletions`, and `cacheSummary.round`, then pause and ask the user to check provider dashboard/logs for the request IDs before trying another strategy.
7. Keep probing until both endpoint families are user-confirmed or every usable strategy in this skill has been exhausted. If one endpoint is confirmed and the other is not, lock the confirmed strategy and continue matrix testing only the unconfirmed endpoint.
8. After detection is complete, provide a concise provider report. Use the script's `providerReport` field first, then explain the findings in human-readable form.

## Confirmation Loop

Use provider dashboard/log confirmation as the decision point for cache-hit behavior. API usage fields are evidence, not the final answer.

- Cache testing is round-bounded. A round is one selected strategy per unconfirmed endpoint, with `--runs 6` by default, including the first cache round. Do not run another strategy or a full matrix in the same assistant turn unless the user explicitly asks to skip confirmation pauses.
- After every cache round, stop and ask the user whether the end-user/provider dashboard shows cache hit for the listed request IDs. Do not mark a strategy confirmed from API usage alone.
- Maintain separate cache status for `/v1/chat/completions` and `/v1/responses`: `unconfirmed`, `api-hit-needs-dashboard-check`, `confirmed-intermittent`, `confirmed-stable`, or `exhausted`.
- When API usage shows cache-read tokens for an endpoint, pause and ask the user to verify that endpoint's request IDs in provider logs before marking the strategy confirmed.
- If the user confirms one endpoint works, keep that strategy as the correct approach for that endpoint. Do not keep retesting it unless the user asks.
- If the other endpoint is still unconfirmed, run the next cache round for the unconfirmed endpoint while preserving the confirmed endpoint strategy in the report.
- Do not report stable cache detection as complete until both endpoints are user-confirmed stable, or until every applicable strategy listed below has been tested and the unconfirmed endpoint is exhausted.
- A single dashboard-confirmed hit proves the mechanism can work, but not that it is stable. If only some later rounds hit, mark the endpoint `confirmed-intermittent`, name the confirmed request ID and cached-token count, and recommend a fresh stability round with the same strategy and more runs.
- If every later round after the first warm-up request hits, mark the endpoint `confirmed-stable`.
- If a strategy intermittently hits, do not reject it. Repeat it with a fresh key before calling it stable or before comparing it against later fallback strategies.

Use `cache-round` for each interactive round:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --runs 6
```

When validating a dashboard-confirmed but intermittent strategy, rerun only that same endpoint and strategy with a fresh generated key and more rounds:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint responses --responseStrategy prompt-key-store-false --confirmedChatStrategy chat-session-header-prompt-cache-key --runs 6
```

In summaries, report `hitRate`, `stability`, `stableAfterWarmup`, and `intermittentHit` from `cacheSummary`. Explain that the first request is a warm-up candidate and the expected stable pattern is that every later request reports cache-read tokens. If only one later request hits, call it intermittent even when the user confirms that one request in the dashboard.

The standard Responses strategy order is `prompt-key-session-header`, `implicit-derived-key`, `prompt-key-store-true`, `prompt-key-store-false`, `session-header-only`, `codex-client-metadata`, then `previous-response`. The standard Chat Completions strategy order is `chat-session-header-prompt-cache-key`, `chat-session-header`, `chat-prompt-cache-key`, then `chat-repeat`.

If Chat Completions is confirmed but Responses is not, lock the chat strategy and continue one Responses round at a time:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint responses --responseStrategy implicit-derived-key --confirmedChatStrategy chat-session-header-prompt-cache-key --runs 6
```

If Responses is confirmed but Chat Completions is not, lock the Responses strategy and continue one chat round at a time:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint chat --chatStrategy chat-session-header-prompt-cache-key --confirmedResponseStrategy prompt-key-session-header --runs 6
```

Use `cache-matrix` only for non-interactive exhaustion when the user explicitly approves running all remaining strategies without dashboard pauses:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-matrix --runs 6
```

Only after the standard round sequence is exhausted should you include late non-standard cache-control probes:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-matrix --matrixMode full --runs 6
```

## Cache Probe Sequence

Use this interactive order. Do not stop after a Responses API hit; Chat Completions cache behavior is a separate characteristic.

1. Run the combined cache probe:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --responseStrategy prompt-key-session-header --chatStrategy chat-session-header-prompt-cache-key --runs 6
   ```
   This tests `/responses` with `prompt_cache_key` plus `Session_id`, and `/chat/completions` with both `Session_id` and top-level `prompt_cache_key`. Summarize both endpoint results and ask the user to verify both routes in provider logs. Stop here until the user responds.
2. If one endpoint shows a cache hit and the other does not, ask the user to confirm the hit endpoint in provider logs. If confirmed and all later rounds hit, lock that strategy as `confirmed-stable` and continue only the unconfirmed endpoint with the next `cache-round`. If confirmed but only some later rounds hit, lock the mechanism as `confirmed-intermittent` and run a same-strategy stability round before calling the endpoint stable.
3. If Responses cache is unclear, retry the Responses strategy alone with a fresh key:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-session-header
   ```
   This covers OpenAI-style `prompt_cache_key` and CLIProxy-style `Session_id`.
4. If Responses still shows no hit or unclear, try backend-derived prompt cache keys:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy implicit-derived-key
   ```
   This covers sub2api-style automatic key derivation for GPT/Codex-like models from model, reasoning, tools, system prompt, and the first user turn.
5. If Responses still needs comparison with ChatHub's current runtime shape:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-true
   ```
6. If the provider rejects `store:true` or treats cache independently of stored response state, try:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-false
   ```
7. If Responses still has no confirmed strategy, continue the Responses strategy order one round at a time. Include `--confirmedChatStrategy <strategy>` when the user already confirmed Chat Completions:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint responses --responseStrategy session-header-only --confirmedChatStrategy chat-session-header-prompt-cache-key --runs 6
   ```
8. If Chat Completions cache is unclear, test chat route strategies explicitly:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-session-header-prompt-cache-key --runs 6
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-session-header --runs 6
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-prompt-cache-key --runs 6
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-repeat --runs 6
   ```
   Run only one of these commands per round, then pause for dashboard confirmation. Report whether `/chat/completions` exposes cache-read usage. If it does not, say chat cache is unconfirmed, not impossible.
9. If Chat Completions still has no confirmed strategy, continue the Chat Completions strategy order one round at a time:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint chat --chatStrategy chat-session-header --confirmedResponseStrategy prompt-key-session-header --runs 6
   ```
   Include `--confirmedResponseStrategy <strategy>` when the user already confirmed Responses.
10. If running manually outside `cache-matrix` and no Responses prompt-key strategy works, try provider state via `previous_response_id`:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-previous-response
   ```
   Explain that this tests provider-managed conversation state, not necessarily prompt cache billing. CLIProxy-style backends may strip `previous_response_id`.
11. Only when the standard matrix is exhausted, or when a backend appears to be Anthropic-compatible behind an OpenAI facade, try cache-control content blocks on both endpoint families:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy cache-control-content-blocks
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-cache-control-content
   ```
12. Pause after each cache round and ask the user to verify vendor dashboard/logs. Report which strategy is compatible with ChatHub as-is and which would require code changes.

## Interpretation Rules

- If `/models` and Chat Completions fail with 401/403, report the key as invalid or unauthorized.
- If `/models` returns HTML or a web app, the base URL is probably missing `/v1`.
- If Chat Completions works but Responses fails, identify rejected fields from the parameter probe before recommending code changes.
- If Responses returns `text/event-stream` when `stream` is omitted, tell the user to keep ChatHub streaming enabled for this provider.
- If `max_tokens` is rejected by Responses, tell the user to disable the agent max-tokens setting for Responses mode or patch the runtime to strip it for this provider.
- If top-level `verbosity` is rejected but `text: { verbosity }` works, identify this as a ChatHub OpenAI-compatible Responses mapping discrepancy.
- Treat these usage fields as cache-read signals: `prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cached_tokens`, `prompt_cache_hit_tokens`, `cache_read_input_tokens`, camelCase equivalents, `usageMetadata.cachedContentTokenCount`, and `timings.cache_n`.
- Treat `cache_creation_input_tokens`, `cached_creation_tokens`, and `input_tokens_details.cached_creation_tokens` as cache-write signals, not proof that the next request hit the cache.
- Responses and Chat Completions can have different cache behavior. A confirmed `/responses` hit does not prove `/chat/completions` hits, and a chat miss does not disprove Responses cache support.
- If one endpoint is confirmed and the other is not, preserve the confirmed endpoint's strategy and continue testing only the unconfirmed endpoint.
- Treat cache stability separately from cache mechanism detection. A `1/2` post-warm-up hit rate means the mechanism is confirmed but intermittent; do not summarize that as fully complete or stable.
- If multiple strategies are run sequentially without a user confirmation pause, later strategies may be warmed by earlier rounds. Treat those results as non-isolated and rerun the candidate strategy in a fresh bounded round before calling it confirmed.
- If cache-read tokens appear only because all input tokens were moved into `cache_read_input_tokens`, warn that this can be a proxy-side billing rewrite. Confirm with provider dashboard/logs.
- If `cache_control` content blocks work in an OpenAI-compatible route, identify that as Anthropic-style behavior. ChatHub's OpenAI-compatible path does not currently emit Anthropic cache-control blocks.
- Treat dashboard confirmation as authoritative for billing/cache behavior when API usage fields and vendor UI disagree.

## Required Final Report

After the baseline, parameter, and cache probes, report these sections:

1. API ability:
   - `/v1/chat/completions`: works or not, accepted/rejected notable parameters, usage shape, and whether cache usage fields appeared.
   - `/v1/responses`: works or not, streaming behavior, accepted/rejected notable parameters, usage shape, and whether cache usage fields appeared.
2. Cache-hit mechanism:
   - For `/v1/responses`, name the successful strategy such as `prompt_cache_key + store:true`, `prompt_cache_key + Session_id`, derived key, or `previous_response_id`.
   - For `/v1/chat/completions`, name the successful strategy such as stable prefix only, `Session_id`, chat `prompt_cache_key`, or say cache is unconfirmed.
   - Include max observed cache-read tokens, hit rate after the first warm-up request, stability status, and the request IDs the user should verify in provider logs.
3. ChatHub compatibility:
   - Say what works as-is.
   - Say what requires runtime changes, such as stripping unsupported Responses fields, mapping `verbosity` to `text.verbosity`, adding `Session_id`, or adding chat-route cache hints.
   - Recommend the OpenAI-compatible provider settings when the strategy is expressible by the current UI:
     - `pptoken.org` preset for Responses derived `prompt_cache_key`, no `Session_id`, `store:true`, with Chat cache off.
     - `apikl.ai` preset for Chat `prompt_cache_key + Session_id` and Responses derived `prompt_cache_key`, no `Session_id`, `store:default` (omit `store`).
     - `Custom` with exact Chat/Responses matrix fields for any other confirmed strategy.
4. Safety:
   - Do not print API keys.
   - Remind the user to rotate any key pasted into chat.

## Script Output

The probe script emits JSON. Use these fields first:

- `diagnosis.keyWorks`
- `diagnosis.chatCompletionsWorks`
- `diagnosis.responsesWorks`
- `diagnosis.baseUrlAdvice`
- `diagnosis.discrepancies`
- `providerReport`
- `cacheSummary`
- for `--phase cache-both`, `cacheSummary.responses`, `cacheSummary.chatCompletions`, and `cacheSummary.comparison`
- for `--phase cache-round`, `cacheSummary.round`, `cacheSummary.round.userConfirmationRequired`, `cacheSummary.round.responses.testedStrategy`, and `cacheSummary.round.chatCompletions.testedStrategy`
- for `--phase cache-matrix`, `cacheSummary.matrix`, `cacheSummary.matrix.responses`, `cacheSummary.matrix.chatCompletions`, `confirmedStrategy`, `testedStrategies`, `hitStrategies`, and `exhausted`
- each result's `status`, `contentType`, `usage`, `cacheSignals`, `cachedTokens`, `diagnosticHeaders`, `errorDetail`, and `textSample`
- cache stability fields: `hitRate`, `stableAfterWarmup`, `intermittentHit`, `stability`, `laterHitCount`, and `laterRoundCount`

Do not paste long raw SSE payloads into the final answer. Summarize the relevant status, rejected parameter, response id, cached token count, and request id.
