# xAI SuperGrok OAuth

Unofficial per-user SuperGrok device-code login so **xAI chat** can use a
consumer SuperGrok session instead of a Console API key. Official vendor docs
cover Console inference (`https://api.x.ai/v1`) and do **not** document this
consumer proxy. ChatHub copies the public Grok CLI / OpenClaw client id
(`b1a00492-073a-47ea-816f-4c329264a828`); consent may label the app
**Grok Build**. It can break if xAI changes that client or the proxy.

## Token sink

Do **not** store SuperGrok tokens in `ai_providers.key_vaults`. That blob is
decrypted into the browser.

| Store | Contents |
| --- | --- |
| `xai_oauth_tokens` | One row per `userId`. AES-GCM `KeyVaultsGateKeeper` ciphertext for access + refresh. `expiresAt`, optional email / plan / `tokenEndpoint`, public `clientId`. Nullable `refreshLockId` / `refreshLockUntil`. The timestamp is informational: acquire only when `refresh_lock_id IS NULL`. An abandoned owner is not reclaimed by expiry. Operators recover with SuperGrok sign-out / sign-in; do not steal the refresh token. |
| `oauth_handoffs` (`client: xai-oauth`) | In-flight RFC 8628 device-code state: `deviceCode`, `userCode`, `tokenEndpoint`, `userId`, `intervalMs`, `nextPollAt`, expiry. No tokens. |

Migration `0060_xai_oauth_tokens` plus
`scripts/migrateServerDB/ensureXaiOAuthTokens.cjs`.

## Login

tRPC `xaiOAuth` (lambda, authed, Settings UI only):

1. `startDeviceLogin` → OIDC discovery at
   `https://auth.x.ai/.well-known/openid-configuration`, then
   `POST {device_authorization_endpoint}` (`client_id` +
   `openid profile email offline_access grok-cli:access api:access`). No PKCE.
2. UI shows the verification URL + `user_code`.
3. `pollDeviceLogin` honors RFC 8628 pacing. The start response stores the
   vendor `interval` (5s default) and `nextPollAt`. Early polls return
   `pending` without a token request. `authorization_pending` stays pending;
   `slow_down` adds 5 seconds and persists the new interval. `expired_token`
   expires the handoff; `access_denied` / `authorization_denied` /
   `invalid_client` deny it. Token redemption is serialized per handoff and
   bounded by `XAI_DEVICE_CODE_TOKEN_TIMEOUT_MS`.
4. Token and device hosts must be HTTPS `*.x.ai`.
5. `status` live-resolves the session, then fail-soft
   `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with
   `x-grok-client-mode: cli` and `x-grok-client-version: 1.0.4`. Usage HTTP
   errors do not disconnect.

## Chat overlay

`resolveXaiOAuthChatPayload` (chat route + durable credentials):

- Live session: `apiKey = accessToken`,
  `baseURL = https://cli-chat-proxy.grok.com/v1`, `authMode = xai-oauth`.
  Runtime attaches the CLI client headers. Missing headers cause HTTP 426.
- No session: Console `https://api.x.ai/v1` with the API key. No CLI headers.
- Skip overlay for `purpose === 'structured'`. Grok Imagine is out of v1.

Force server-side fetch while `xaiOAuthConnected` is true
(`isProviderFetchOnClient`).

## Cache

Trusted conversation id from `createTrustedPromptCacheKey` (`ch_…`):

- Chat Completions: header `x-grok-conv-id` only (not `Session_id`)
- Responses: body `prompt_cache_key`

`DEBUG_XAI_CACHE=1` logs presence + hash, plus `cached_tokens`.
`CHATHUB_XAI_OAUTH_DEBUG=1` logs safe OAuth metadata.

## Sources

- [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)
- [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- OpenClaw `extensions/xai/xai-oauth.ts` / `usage.ts`
