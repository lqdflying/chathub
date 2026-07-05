# Repo Skills

This folder contains repo-local Codex skills for ChatHub maintenance and diagnostics.

Each skill lives in its own directory and must include a `SKILL.md`. Some skills also include:

- `scripts/` for repeatable commands or probes
- `references/` for extra context Codex should read only when needed
- `agents/openai.yaml` for UI metadata

## Available Skills

### `chathub-provider-probe`

Use this skill to test an OpenAI-compatible provider against ChatHub's expected Chat Completions, Responses API, and cache-hit behavior.

Required environment variables:

```bash
export PROBE_OPENAICOMPATIBLE_API_KEY='...'
export PROBE_OPENAICOMPATIBLE_PROXY_URL='https://provider.example.com/v1'
```

Optional model override:

```bash
export PROBE_OPENAICOMPATIBLE_MODEL='gpt-5.5'
```

These `PROBE_*` variables are dedicated to the diagnostic skill and are separate from ChatHub's normal provider configuration.

Run baseline checks:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase baseline
```

Run parameter compatibility checks:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase params
```

Run one bounded cache-hit round for Responses API and Chat Completions:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --runs 6
```

After each round, inspect `cacheSummary.responses`, `cacheSummary.chatCompletions`, `cacheSummary.round`, and `cacheSummary.comparison`. Verify the listed `/v1/responses` and `/v1/chat/completions` request IDs in the provider dashboard or logs before trying the next strategy.

Run one strategy per unconfirmed endpoint per round. The first cache round and later interactive rounds use six runs by default. Do not run a full matrix interactively unless the user explicitly asks to skip confirmation pauses.

The standard round order covers Responses strategies `prompt-key-session-header`, `implicit-derived-key`, `prompt-key-store-default`, `prompt-key-store-true`, `prompt-key-store-false`, `session-header-only`, `codex-client-metadata`, and `previous-response`; and Chat Completions strategies `chat-session-header-prompt-cache-key`, `chat-session-header`, `chat-prompt-cache-key`, and `chat-repeat`.

If Chat Completions is confirmed but Responses is not, lock the chat strategy and continue one Responses round:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint responses --responseStrategy implicit-derived-key --confirmedChatStrategy chat-session-header-prompt-cache-key --runs 6
```

If Responses is confirmed but Chat Completions is not, lock the Responses strategy and continue one chat round:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint chat --chatStrategy chat-session-header-prompt-cache-key --confirmedResponseStrategy prompt-key-session-header --runs 6
```

Use the full matrix only for non-interactive exhaustion after explicit approval:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-matrix --runs 6
```

Only after the standard matrix is exhausted, include late non-standard cache-control probes:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-matrix --matrixMode full --runs 6
```

The script also emits `providerReport`, which summarizes:

- how `/v1/chat/completions` behaves
- how `/v1/responses` behaves
- which cache-hit mechanism worked for each endpoint
- request IDs to verify in provider logs
- `providerReport.recommendedSettings.checklist` with every UI option to set, including Responses `max_tokens`, `max_output_tokens`, `truncation`, and `verbosity`
- recommended ChatHub settings or compatibility changes

Current OpenAI-compatible cache presets in the settings UI:

- `Prompt key + store`: Responses API on; Chat `prompt_cache_key`, no `Session_id`; Responses derived `prompt_cache_key`, no `Session_id`, `store:true`; optional Responses parameter fields omitted. This is the shared mode verified for `pptoken.org` and `apikl.ai`.
- `Custom`: use the exact cache and Responses parameter fields confirmed by the probe when the provider differs from the presets. Built-in presets keep the detailed matrix hidden; `Custom` expands every option, including `max_tokens`, `max_output_tokens`, `truncation`, and `verbosity`.

Responses API follow-up probes:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-session-header --runs 6
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy implicit-derived-key
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-default
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-true
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-false
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-previous-response
```

Chat Completions follow-up probes:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-session-header-prompt-cache-key
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-session-header
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-prompt-cache-key
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-repeat
```

When API usage reports a cache hit, pause and ask the user to confirm the request IDs in provider logs. Keep confirmed endpoint mechanisms locked and continue probing the other endpoint one bounded round at a time until both `/v1/responses` and `/v1/chat/completions` are confirmed, or until all applicable strategies are exhausted.

Track stability separately from mechanism detection. The first request is the warm-up candidate; stable cache behavior means every later request in the round reports cache-read tokens. If only some later requests hit, report the strategy as confirmed intermittent, include `hitRate`, `stability`, max cached tokens, and request IDs, then rerun the same endpoint/strategy with a fresh key and more rounds before calling it stable:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-round --endpoint responses --responseStrategy prompt-key-store-default --confirmedChatStrategy chat-session-header-prompt-cache-key --runs 6
```

Optional late-stage probes for gateways that appear to accept non-standard cache hints:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy session-header-only
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy codex-client-metadata
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy cache-control-content-blocks
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat --strategy chat-cache-control-content
```

## Invoking From Codex

Ask Codex to use the skill by name:

```text
Use $chathub-provider-probe to test my OpenAI-compatible provider.
```

If the repo-local skill is not auto-discovered by the current Codex environment, point Codex at the skill file directly:

```text
Use the skill at skills/chathub-provider-probe/SKILL.md to test my provider.
```

## Safety Notes

- Do not paste long-lived API keys into chat. Prefer environment variables.
- Rotate any key that was pasted into the conversation.
- The probe script redacts the API key from output, but shell history and terminal scrollback are still your responsibility.
- Cache-hit billing behavior should be confirmed with the vendor dashboard when API usage fields and vendor UI disagree.
