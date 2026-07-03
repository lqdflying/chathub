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
export CHATHUB_OPENAICOMPATIBLE_API_KEY='...'
export CHATHUB_OPENAICOMPATIBLE_PROXY_URL='https://provider.example.com/v1'
```

Optional model override:

```bash
export CHATHUB_OPENAICOMPATIBLE_MODEL='gpt-5.5'
```

Run baseline checks:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase baseline
```

Run parameter compatibility checks:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase params
```

Run the first cache-hit strategy:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-key --strategy prompt-key-store-true
```

After each cache probe, inspect `cacheSummary` and verify the provider dashboard or logs before trying the next strategy:

```bash
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-previous-response
node skills/chathub-provider-probe/scripts/probe-openai-compatible.mjs --phase cache-chat-repeat
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

