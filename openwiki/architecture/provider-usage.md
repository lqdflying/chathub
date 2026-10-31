# Provider balance and usage

Settings → provider shows a **Balance & usage** card for native providers whose
balance, plan quota, or spend can be read server-side. The card sits under the
provider config form (`ProviderConfig` → `features/ProviderUsage`). It refreshes
after Connectivity Check and has its own refresh button.

OpenAI-compatible, Anthropic-compatible, and custom providers are **not**
supported on purpose. SuperGrok OAuth and Codex OAuth keep their own meters
(`xai-oauth.md`, `openai-codex-oauth.md`) and are not changed by this card.

## Data flow

1. `lambda.providerUsage.get` / `refresh` (authed, `verifiedAccountScope`) →
   `ProviderUsageService.getUsage(provider)`.
2. The service resolves one credential (below), then calls the provider's
   adapter in `src/server/services/providerUsage/adapters/`.
3. The adapter does one `GET` with a 10 s timeout and a pure parser turns the
   body into a `ProviderUsageSnapshot` (`types.ts`): `balances[]`, `windows[]`,
   `spend`, `plan`, `status`, `reason`, `unofficial`.
4. Vendor, network, and parse failures become a `status`
   (`authError` / `unavailable` / `error`), never a thrown error.
5. Snapshots are cached in memory for 60 s per user, provider, credential
   source, key fingerprint (SHA-256 prefix of the full key), base URL, and
   team id. `refresh` and admin-key saves bypass or clear the cache.

The provider list lives in `packages/const/src/providerUsage.ts`;
`adapters/index.test.ts` fails if the list and the registry drift apart.

## Credentials

| Kind | Providers | Source order |
| --- | --- | --- |
| API key | DeepSeek, Moonshot / Kimi, Zhipu, MiniMax | user key vault (legacy settings vault merged with `ai_providers.key_vaults`, first of a comma list) → `{PROVIDER}_API_KEY` **only if** `ENABLE_PROVIDER_USAGE_SERVER_KEYS` is on |
| Admin key | OpenAI, Anthropic, xAI | user row in `provider_usage_credentials` → `OPENAI_ADMIN_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` / `XAI_MANAGEMENT_API_KEY` + `XAI_MANAGEMENT_TEAM_ID` **only if** the same switch is on |

- The base URL follows chat: the user's endpoint, else `{PROVIDER}_PROXY_URL`.
- `ENABLE_PROVIDER_USAGE_SERVER_KEYS` (`1` / `true`, default off) is the only
  way other users see the operator's balance. With it off and no user key, the
  card reports `noCredential` and makes no outbound call.
- Admin providers never fall back to the chat API key.
- The UI only ever receives a `****abcd` hint, never a key.

### `provider_usage_credentials` (migration 0063)

Composite PK `(user_id, provider)`, `ON DELETE cascade` to `users`.
`credential` is `KeyVaultsGateKeeper` AES-GCM ciphertext of
`{"apiKey","teamId?"}`; `key_hint` is the last four characters. It is **not**
stored in `ai_providers.key_vaults` because that blob is decrypted into the
browser. Repair: `scripts/migrateServerDB/ensureProviderUsageCredentials.cjs`
(wired in `docker.cjs`, copied in the `Dockerfile`). A missing table or a bad
ciphertext reads as "no saved key".

## Endpoints

| Provider | Endpoint | Status of the contract |
| --- | --- | --- |
| DeepSeek | `GET {base without /v1}/user/balance` → `balance_infos[]` | Official ([docs](https://api-docs.deepseek.com/api/get-user-balance)) |
| Moonshot | `GET {base}/v1/users/me/balance` → `data.available/voucher/cash_balance`; `.cn` host = CNY, else USD | Official ([docs](https://platform.moonshot.ai/docs/api/balance)) |
| Kimi Code | base host `api.kimi.com` → `GET {base}/v1/usages` (`limits[]` 5 h + weekly `usage`) | Unofficial (kimi-cli source) |
| Zhipu / Z.ai | `GET {origin}/api/monitor/usage/quota/limit` (Coding Plan 5 h, weekly, MCP monthly); retries once without `Bearer` after 401 | Unofficial (community clients) |
| MiniMax | `GET https://www.minimax.io` or `www.minimaxi.com` + `/v1/token_plan/remains`; legacy `coding_plan/remains` only after 404 | Endpoint in the official FAQ; fields unofficial |
| xAI | Management API `GET /v1/billing/teams/{team}/prepaid/balance`; team from the saved id or `/auth/management-keys/validation` | Official ([docs](https://docs.x.ai/developers/rest-api-reference/management/billing)) |
| OpenAI | `GET /v1/organization/costs` (Admin key) → month-to-date spend | Official; no remaining-credit endpoint exists |
| Anthropic | `GET /v1/organizations/cost_report` (Admin key, cents strings) → month-to-date spend | Official but marked legacy in favor of the Analytics API |

Not supported: Google Gemini, Azure OpenAI, Azure AI, Xiaomi MiMo (no usable
endpoint), and pay-as-you-go balances for Zhipu and MiniMax.

### Parsing traps

- xAI `total.val` is an inverted cents ledger: a $10 top-up is `"-1000"`.
- MiniMax `current_weekly_status: 0` means "no weekly limit"; the weekly row is
  skipped so it never reads as 0 % left. Interval length (5 h vs 24 h) comes
  from `end_time - start_time`.
- Zhipu weekly rows appear as `unit: 6, number: 7`; both 6/1 and 6/7 are
  treated as one week, with the vendor `type` label as fallback.
- Kimi numbers come back as strings and `used` may be missing.

None of these could be live-probed from the cloud sandbox; fixtures come from
vendor examples and community captures cited in each adapter.
