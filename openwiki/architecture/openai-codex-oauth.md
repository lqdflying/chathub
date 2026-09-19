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

## Login

tRPC `openaiCodex` (lambda, authed):

1. `startDeviceLogin` → `POST https://auth.openai.com/api/accounts/deviceauth/usercode`
2. UI shows `https://auth.openai.com/codex/device` + `user_code` (15 minutes)
3. `pollDeviceLogin` → `POST .../deviceauth/token`, then
   `POST https://auth.openai.com/oauth/token` (`authorization_code`,
   `redirect_uri=https://auth.openai.com/deviceauth/callback`, `code_verifier`)
4. JWT claim `https://api.openai.com/auth` → `chatgpt_account_id` (required)
5. `status` returns email / plan / expiry only
6. `logout` deletes the token row; API key vaults are untouched

Refresh uses `grant_type=refresh_token` about five minutes before expiry.
Before any vendor redeem, the worker must take the row's refresh lease
(`refresh_lock_id` / `refresh_lock_until`) and re-read the ciphertext.
Same-process resolvers also take an in-memory per-user lock; that map is
not shared across Node workers, so the database lease is the exclusion
that prevents two processes from redeeming the same refresh token.
Rotation is then versioned on the stored refresh ciphertext: `UPDATE`/`DELETE`
only when that ciphertext still matches. A stale refresh cannot recreate a
logged-out row or overwrite a newer login. Confirmed `invalid_grant` /
reused refresh deletes only the matching version. HTTP 429/5xx, transport
failures, and malformed 2xx responses keep the row; if the access token is
still valid, chat continues on Codex, and if it has expired, resolve throws
`OpenAICodexTransientRefreshError` so chat cannot silently use the Platform
key.

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

## Key source references

- `src/server/services/openaiCodex/`
- `src/server/routers/lambda/openaiCodex.ts`
- `packages/model-runtime/src/providers/openai/codexResponses.ts`
- `packages/database/src/schemas/openaiCodexOAuth.ts`
