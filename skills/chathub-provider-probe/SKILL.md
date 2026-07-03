---
name: chathub-provider-probe
description: Probe and diagnose ChatHub OpenAI-compatible providers using CHATHUB_OPENAICOMPATIBLE_API_KEY and CHATHUB_OPENAICOMPATIBLE_PROXY_URL. Use when the user asks to verify whether a custom OpenAI-compatible key/base URL works with ChatHub, compare Chat Completions vs Responses API behavior, identify parameter discrepancies with the repo's current OpenAI-compatible runtime, or interactively test prompt-cache/cache-hit behavior across multiple simulated chat rounds.
---

# ChatHub Provider Probe

## Workflow

Use this skill to run live, low-cost API simulations against a ChatHub OpenAI-compatible provider. Never print the API key. Treat the key as sensitive and remind the user to rotate it if they pasted it in chat.

1. Confirm the environment variables exist:
   - `CHATHUB_OPENAICOMPATIBLE_API_KEY`
   - `CHATHUB_OPENAICOMPATIBLE_PROXY_URL`, expected to include `/v1`
   - Optional: `CHATHUB_OPENAICOMPATIBLE_MODEL`, default `gpt-5.5`
2. Run the baseline probe:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase baseline
   ```
3. Run the parameter compatibility probe:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase params
   ```
4. Compare results with ChatHub's current runtime behavior. Read `references/chathub-openai-compatible-runtime.md` when interpreting discrepancies.
5. For cache-hit testing, run one strategy, summarize the observed `cached_tokens` and relevant response headers, then pause and ask the user to check the vendor dashboard/logs before trying the next strategy.

## Cache Probe Sequence

Use this interactive order:

1. Prompt-cache key with provider state enabled:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-true
   ```
   Summarize whether the second round reported `usage.input_tokens_details.cached_tokens > 0`. Ask the user to verify whether the provider dashboard shows a cache hit.
2. If the user says no hit or unclear, try provider state via `previous_response_id`:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-previous-response
   ```
   Explain that this tests provider-managed conversation state, not necessarily prompt cache billing.
3. If still no hit, try repeated Chat Completions:
   ```bash
   node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat
   ```
4. Stop after the third strategy unless the user asks to continue. Report which strategy is compatible with ChatHub as-is and which would require code changes.

## Interpretation Rules

- If `/models` and Chat Completions fail with 401/403, report the key as invalid or unauthorized.
- If `/models` returns HTML or a web app, the base URL is probably missing `/v1`.
- If Chat Completions works but Responses fails, identify rejected fields from the parameter probe before recommending code changes.
- If Responses returns `text/event-stream` when `stream` is omitted, tell the user to keep ChatHub streaming enabled for this provider.
- If `max_tokens` is rejected by Responses, tell the user to disable the agent max-tokens setting for Responses mode or patch the runtime to strip it for this provider.
- If top-level `verbosity` is rejected but `text: { verbosity }` works, identify this as a ChatHub OpenAI-compatible Responses mapping discrepancy.
- Treat dashboard confirmation as authoritative for billing/cache behavior when API usage fields and vendor UI disagree.

## Script Output

The probe script emits JSON. Use these fields first:

- `diagnosis.keyWorks`
- `diagnosis.chatCompletionsWorks`
- `diagnosis.responsesWorks`
- `diagnosis.baseUrlAdvice`
- `diagnosis.discrepancies`
- `cacheSummary`
- each result's `status`, `contentType`, `usage`, `cachedTokens`, `errorDetail`, and `textSample`

Do not paste long raw SSE payloads into the final answer. Summarize the relevant status, rejected parameter, response id, cached token count, and request id.
