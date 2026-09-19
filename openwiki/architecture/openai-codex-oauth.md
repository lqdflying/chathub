# OpenAI Codex OAuth (ChatGPT subscription)

Unofficial per-user ChatGPT / Codex login so OpenAI **chat** can use Plus/Pro
quota instead of a Platform API key. Official vendor docs only cover Codex
CLI / IDE / desktop. ChatHub copies the public Codex device-code client
(`app_EMoamEEZ73f0CkXaXp7hrann`) used by OpenClaw; it can break if OpenAI
changes that client or the Codex backend.

## Token sink

Do **not** store Codex tokens in `ai_providers.key_vaults`. That blob is
decrypted into the browser.

| Store | Contents |
| --- | --- |
| `openai_codex_oauth_tokens` | One row per `userId`. AES-GCM `KeyVaultsGateKeeper` ciphertext for access + refresh. `expiresAt`, `accountId`, optional email / plan, public `clientId`. Nullable `refreshLockId` / `refreshLockUntil` lease so only one worker redeems a given refresh token. |
| `oauth_handoffs` (`client: openai-codex-device`) | In-flight device-code state: `deviceAuthId`, `userCode`, `userId`, expiry. No tokens. |

Migrations `0058_openai_codex_oauth_tokens` and
`0059_openai_codex_oauth_refresh_lock`, plus
`scripts/migrateServerDB/ensureOpenAICodexOAuthTokens.cjs`.
The ensure helper must not re-add
`openai_codex_oauth_tokens_user_id_unique` when Drizzle already created
that constraint and its backing index: PostgreSQL then raises `42P07`
(`duplicate_table`), which is distinct from `42710` (`duplicate_object`).

## Login

tRPC `openaiCodex` (lambda, authed):

1. `startDeviceLogin` → `POST https://auth.openai.com/api/accounts/deviceauth/usercode`
2. UI shows `https://auth.openai.com/codex/device` + `user_code` (15 minutes)
3. `pollDeviceLogin` → `POST .../deviceauth/token`, then
   `POST https://auth.openai.com/oauth/token` (`authorization_code`,
   `redirect_uri=https://auth.openai.com/deviceauth/callback`, `code_verifier`)
4. JWT claim `https://api.openai.com/auth` → `chatgpt_account_id` (required)
5. `status` returns email / plan / expiry, then fail-soft `GET https://chatgpt.com/backend-api/wham/usage` (official Codex ChatGPT path) and attaches 5-hour / weekly remaining when those windows exist. Usage HTTP errors do not disconnect.
6. `logout` deletes the token row; API key vaults are untouched

Refresh uses `grant_type=refresh_token` about five minutes before expiry.
Before any vendor redeem, the worker must take a free refresh lease
(`refresh_lock_id` is null), then re-read the ciphertext. A held lease
stays exclusive through the token request, response-body read, and
credential write. `refresh_lock_until` is a liveness hint only: wall-clock
expiry does not let another worker steal the lease or redeem the same
refresh token. Same-process resolvers also take an in-memory per-user
lock; that map is not shared across Node workers.
Rotation and `invalid_grant` deletion are versioned on the stored refresh
ciphertext **and** the caller's `refresh_lock_id`. A stale owner that lost
the lease cannot delete or overwrite a newer login or an in-flight
successor. A later worker may redeem only after the owner releases
(persist, confirmed invalid delete, logout, or an explicit release of a
still-valid row). A crashed owner that never reaches `finally` leaves the
lease held; contenders keep a still-valid access token or throw
`OpenAICodexTransientRefreshError` instead of redeeming. User logout
clears a stuck row. HTTP 429/5xx, transport failures, and malformed 2xx
responses keep the row; if the access token is still valid, chat continues
on Codex, and if it has expired, resolve throws so chat cannot silently
use the Platform key.

## Server-only credential resolve

`resolveOpenAICodexChatPayload` overlays `{ authMode: 'codex-oauth', apiKey: accessToken, accountId, baseURL: https://chatgpt.com/backend-api/codex }` for provider `openai` when a live row exists **and** `purpose` is not `structured`.

Call sites:

- `src/app/(backend)/webapi/chat/[provider]/route.ts` (chat)
- `src/app/(backend)/webapi/models/[provider]/route.ts` (chat catalog)
- `src/server/services/conversationGeneration/credentials.ts` (`purpose: 'chat'` default; supervisor passes `structured`)

Image / TTS / STT / embedding routes and group-supervisor `generateObject`
keep the Platform key. Browser XOR payloads must not carry Codex tokens.
`isProviderFetchOnClient('openai')` is forced off while
`openaiCodexConnected` is true. Status queries are keyed by
`userStateScope` and use `verifiedAccountScope`.

A live Codex row is a credential even with no vault key and no `OPENAI_API_KEY`.

## Codex `/responses` contract

`LobeOpenAI` branches on `authMode === 'codex-oauth'`:

- `POST https://chatgpt.com/backend-api/codex/responses` (SSE only)
- Headers: `Authorization: Bearer`, `chatgpt-account-id`,
  `OpenAI-Beta: responses=experimental`, `accept: text/event-stream`,
  `originator: chathub`, `User-Agent: ChatHub`
- Body: `store: false`, `stream: true`, top-level `instructions`, `input`
  from non-system messages, `include: ["reasoning.encrypted_content"]`,
  optional `text.verbosity` / `reasoning.effort`, tools with `strict: false`

Live catalog: `GET .../codex/models?client_version=0.154.0` (pinned Codex CLI
version). Static fallback if the fetch fails.

## Diagnostics

`CHATHUB_OPENAI_CODEX_DEBUG=1` emits prefixed JSON
`[chathub-openai-codex-debug:<event>]`. Safe fields only: HTTP status,
media-type class, durations, SSE event counts, allowlisted outcomes
(`ok` / `empty` / `failed` / `incomplete` / `unexpected_end` /
`parse_error` / `cancelled` / `error` / `pending` / `connected` /
`denied` / `live` / `missing` / `codex` / `platform` / `transient`).
`usage_fetch_settled` reports HTTP status and whether 5-hour / weekly windows were present. `chat_request_settled` `ok` is HTTP 200 only. `chat_stream_settled`
follows the Responses lifecycle (`onCompletion` / `onError` terminal
reason / cancel), not whether any SSE frame parsed. Tokens, device
codes, emails, and prompt/response text are never logged. Platform
`DEBUG_OPENAI_CHAT_COMPLETION` / `DEBUG_OPENAI_RESPONSES` do **not** cover
this path — `LobeOpenAI.chat` bypasses the factory when
`authMode === 'codex-oauth'`.

## Key source references

- `src/server/services/openaiCodex/`
- `src/server/routers/lambda/openaiCodex.ts`
- `packages/model-runtime/src/providers/openai/codexResponses.ts`
- `packages/database/src/schemas/openaiCodexOAuth.ts`
