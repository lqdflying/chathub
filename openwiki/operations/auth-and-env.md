# Authentication and Environment Setup

ChatHub's runtime configuration is driven heavily by environment variables. Authentication is not optional: the README states that at least one of `NEXT_PUBLIC_ENABLE_NEXT_AUTH`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or `AUTH_TOKEN` must be set.

## Authentication model

The top-level README documents the built-in credentials login flow, including:

- username/password login
- access-token login
- optional combination with OAuth providers
- JWT-based session handling
- automatic user bootstrap on the first authenticated request

The current repo also contains a dedicated background document at `doc/credentials-login-flow.md` that describes how credentials login behaves in practice.

### Mobile session resume

The NextAuth client does not revalidate the session merely because a mobile
browser or installed PWA returns to the foreground. `SessionProvider` sets both
`refetchOnWindowFocus` and `refetchWhenOffline` to `false`. This avoids treating
a transient resume-time transport, HTTP, or JSON failure as a definitive
unauthenticated session and consequently clearing every account-scoped store.

`SessionFreshnessPoller` instead probes the session endpoint every five minutes
while the browser reports an online connection. Network failures, non-success
responses, and invalid JSON are inconclusive and preserve the last confirmed
session. Each probe is bound to the current `session.user.id`; an identity or
authentication-status change aborts the request and invalidates its result. A
successful JSON `null` response uses Auth.js sign-out propagation only while the
same identity is still active, so a delayed probe from account A cannot sign out
a replacement account B session. This bounds stale client state without
reintroducing the unreliable foreground-resume request or Auth.js beta's
built-in polling path, which collapses fetch failures to `null`. Initial session
loading, explicit sign-in/sign-out, Auth.js cross-tab session broadcasts, and
successful probe responses remain authoritative. `UserUpdater` mirrors
authenticated and genuine unauthenticated states into the user store; it does
not maintain a second cached session or suppress a real sign-out. On a confirmed
unauthenticated status it clears the raw auth ID, NextAuth session/user, and
mapped user identity together.

ChatHub defaults `NEXT_AUTH_SSO_SESSION_STRATEGY` to `jwt`. Deployments that
explicitly select Auth.js database sessions retain Auth.js's upstream session
endpoint limitation: an adapter failure can produce the same successful `null`
body as a missing session. The custom poller removes false sign-outs caused by
browser-visible transport and response failures but cannot disambiguate that
server-internal database-session case.

### Static bearer authentication boundary

Machine-to-machine requests authenticate with
`Authorization: Bearer <AUTH_TOKEN>`. Lambda tRPC, Edge tRPC, model-runtime
guards, and route middleware all validate that bearer directly against the
server-side `AUTH_TOKEN` using the shared constant-time comparator. Successful
validation derives the raw authentication principal only from
`AUTH_USER_ID` (falling back to `default_user` for direct API bearer access);
request headers cannot select the user.

Backend WebAPI requests still decode the client-generated
`X-lobe-chat-auth` payload for provider credentials and runtime options. Each
WebAPI route uses the shared resolver to validate `Oidc-Auth`, Clerk, NextAuth,
or static bearer authentication directly at the route boundary. When
`ENABLE_OIDC=1`, a valid OIDC access token is authoritative and binds the
request to its validated `sub`; a supplied but invalid token is terminal and
cannot fall through to an access code or provider API key. When OIDC is
disabled, the resolver does not validate or accept `Oidc-Auth`, even when a
JWKS remains configured, so previously issued tokens grant no WebAPI identity.
The remaining configured authentication and access-code rules determine the
request outcome.

Otherwise, the first configured method that validates returns an authoritative
database owner: Clerk returns its mapped owner, NextAuth returns
`session.user.id`, and static bearer authentication returns `AUTH_USER_ID`. The
server overwrites the payload's `userId` with that owner before invoking the
route handler. The decoded payload therefore cannot redirect user-scoped model
runtime, tracing, cache, or nested tRPC work to another database owner. Keeping
the OIDC feature gate in the shared resolver follows
[OWASP's authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
to deny by default and validate access on every request.

Configured server authentication fails closed. If none of the enabled Clerk,
NextAuth, or static bearer methods validates the request, WebAPI execution stops
with `Unauthorized`; payload API keys, access codes, or an empty access-code
configuration are not fallback authentication. Those legacy payload methods
remain available only when all server authentication modes are disabled.

The fail-closed route boundary covers model WebAPIs and the operational
endpoints that can create server-side effects:

- OpenAI TTS and STT authenticate before parsing audio input or creating an
  OpenAI client.
- `/webapi/proxy` authenticates before reading the target URL or issuing an
  SSRF-safe outbound fetch.
- `/webapi/tools/apitest` authenticates before parsing or executing the
  requested API probe.
- `/webapi/trace` authenticates before parsing or mutating a trace event.

Browser callers send the standard encrypted `X-lobe-chat-auth` payload to these
routes. Operational endpoints accept its access code only when all server
authentication modes are disabled; an arbitrary provider API key cannot
authorize proxy, API Tester, or trace access. OpenAI TTS/STT are the narrow
exception: when server authentication is disabled, they may use the encrypted
OpenAI API key because that credential is consumed by the same upstream audio
operation. If server authentication is configured, the validated session or
bearer remains mandatory even when an OpenAI key is present.

OpenAI audio credential selection also binds endpoint ownership. A browser
OpenAI key may be paired with that browser payload's `baseURL`. If the audio
route falls back to the deployment's `OPENAI_API_KEY`, it ignores the browser
`baseURL` and uses only the deployment-controlled `OPENAI_PROXY_URL` or the
OpenAI SDK default. This follows the
[OpenAI Node SDK contract](https://github.com/openai/openai-node/blob/master/src/client.ts),
where `baseURL` selects the request destination and `apiKey` is automatically
sent there as a Bearer credential, and
[OWASP's SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet)
to restrict privileged outbound calls to identified trusted destinations.

`X-oauth-authorized` is legacy, untrusted input and is not read as an
authorization signal. Auth.js documents that route handlers should use
[`auth()`](https://authjs.dev/getting-started/session-management/protecting) to
validate the current session close to the protected operation. ChatHub follows
that pattern for model WebAPI routes, operational WebAPI routes, and the plugin
gateway instead of trusting a header written by middleware. The deprecated
`createBizOpenAI` path that consumed this marker has been removed.

`X-token-auth-user` is legacy, untrusted input and is never accepted as proof
of identity. In particular, a caller cannot combine that header with
`X-ChatHub-Account-Scope` to choose an API-key or Picbed tenant. Sensitive
account middleware compares the asserted account scope with the explicit raw
principal recorded by a validated authentication mechanism, not with the
generic `userId` that may later represent a mapped database owner.

Clerk development impersonation preserves this separation explicitly:
`clerkAuth.userId` remains the raw authenticated Clerk principal used by
account-scope verification, while the mapped `userId` remains the database
owner. Lambda and Edge contexts must never populate `rawAuthUserId` from the
mapped owner.

Do not attempt to pass token identity through response headers. Next.js 15
documents that only
[`NextResponse.next({ request: { headers } })`](https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware#setting-headers)
forwards modified headers upstream; setting `response.headers` exposes a
response header instead. ChatHub validates the bearer again in each server
context rather than making middleware forwarding part of the authorization
boundary. The bounded constant-time comparison follows
[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
for secret comparisons.

## LLM environment configuration

The main provider environment map lives in `src/envs/llm.ts`, which is referenced from the README as the canonical provider/env source. That config drives how server runtime code resolves keys and base URLs for providers like OpenAI, Anthropic, Azure, and provider-compatible gateways.

Moonshot supports `MOONSHOT_PROXY_URL` for a custom OpenAI-compatible base URL. Runtime precedence is request/user-provider `baseURL` first, then `MOONSHOT_PROXY_URL`, then the built-in `https://api.moonshot.cn/v1` default.

A notable recent change in `src/server/modules/ModelRuntime/index.ts` is special handling for Anthropic-compatible auth mode and proxy URL resolution. This makes provider configuration a live compatibility surface rather than a static list of keys.

## Deployment notes

The README presents Docker + PostgreSQL as the primary deployment target. Migrations run automatically in the container startup flow, and the README points readers to the Docker deployment wiki for upgrade procedures and troubleshooting.

`APP_URL` remains required in server-mode deployments and should point at the
public ChatHub origin used by browsers, OAuth callbacks, webhooks, and canonical
links. Server-to-server async jobs may use `INTERNAL_APP_URL` instead. The
async caller resolves its origin in this order:

1. valid explicit `INTERNAL_APP_URL`
2. `http://127.0.0.1:${PORT || 3210}` when Docker local rewrite is enabled and
   the app is not running on Vercel
3. public `APP_URL`

`INTERNAL_APP_URL` must be a clean HTTP(S) origin such as
`http://127.0.0.1:3210`: no credentials, path, query string, or fragment.
Invalid values emit an `invalid_internal_app_url` diagnostic warning and use
the normal loopback/`APP_URL` fallback instead.

This keeps background image, file-processing, and RAG jobs away from external
CDNs/proxies when a container-local route is available.

## Provider debug environment variables

Provider runtime debugging is opt-in and should be used only for active troubleshooting. The provider chat-completion flags emit raw request payloads and stream chunks, and some providers also emit a redacted structured request-shape line:

```bash
DEBUG_MOONSHOT_CHAT_COMPLETION=1
DEBUG_MINIMAX_CHAT_COMPLETION=1
DEBUG_DEEPSEEK_CHAT_COMPLETION=1
DEBUG_ANTHROPICCOMPATIBLE_CHAT_COMPLETION=1
```

The structured line starts with `[provider-debug:request]` and includes provider, hashed endpoint origin/path, path depth, query-key names, upstream route, model, stream flag, payload fingerprint, turn shape, tool count/fingerprint, and key parameter presence. It omits URL credentials, hosts, path segments, query values, authorization secrets, and tool names. It is intended for comparing endpoint/request shape without immediately inspecting full prompt text.

The same flags still enable raw `[requestPayload]` and stream logs, so do not leave them enabled in privacy-sensitive production sessions. For OpenAI-compatible cache diagnostics, prefer `DEBUG_OPENAICOMPATIBLE_CACHE=1`, which is a separate redacted cache-focused logger.

## Tool and MCP debug environment variable

`CHATHUB_TOOLS_DEBUG` is a server-side switch for dedicated, PII-safe prefixed-JSON tool diagnostics. It works standalone and does not alter the global Pino level; use `CHATHUB_DEBUG=1` or `LOG_LEVEL` separately when global Pino debug output is wanted.

| Value               | Effect                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| unset / `0` / `off` | Structured tool diagnostics off (default)                                                                             |
| `1` / `safe`        | Complete request lifecycle with safe labels, status, timing, retry/cache/OAuth state, shapes, sizes, and fingerprints |
| `verbose` / `2`     | Safe records plus deeper bounded object/array shape fingerprints; never raw content                                   |

Output uses `[chathub-tools-debug:<event>]` followed by one versioned JSON object. The production parser maps this to `debug_namespace=chathub-tools-debug` and `debug_event=<event>`. An opaque `diagnosticId`, `spanId`, and per-span event sequence correlate tRPC, cache, OAuth, transport, MCP, normalization, serialization, direct server-database tool-result persistence, the desktop/client-required `/trpc/lambda` fallback, and browser response failures. Safe records include sanitized technical labels and credential-free endpoint paths, while user/connection identity remains hashed.

Neither level records raw request/response bodies, HTML, tool arguments/results, prompts, resources, arbitrary error messages, stdout/stderr, environment values, URL query/fragment, authorization/cookies, OAuth codes/state/verifiers, session values, tokens, keys, passwords, or secrets. Secret-keyed values are removed rather than fingerprinted. Invalid JSON is classified using safe metadata such as `bodyKind`, status, media type, bytes, HTML marker, proxy hints, and a bounded response fingerprint; the native parser excerpt is discarded. Records are capped at 16 KiB.

Explicit `DEBUG=chathub-tools:safe|verbose` remains available as a legacy plain-text fallback. Structured output wins per event when both switches enable it, preventing duplicate records. Other explicit `DEBUG=...` namespaces are preserved and deduped. Existing `lobe-mcp:*`, `context-engine:*`, `lobe-search:*`, and `lobe-chat:*` namespaces are never auto-enabled; some have broader/raw logging contracts and should be explicit, short-lived troubleshooting opt-ins. An unrecognized `CHATHUB_TOOLS_DEBUG` value is treated as off with a one-line startup warning.

## Image debug environment variable

`CHATHUB_IMAGE_DEBUG` is a server-only switch for PII-safe image generation
diagnostics. It works standalone and does not lower global Pino level.

| Value               | Effect                                                        |
| ------------------- | ------------------------------------------------------------- |
| unset / `0` / `off` | Structured image diagnostics off (default)                    |
| `1` / `safe`        | Submission, dispatch, provider, transform, upload, task state |
| `verbose` / `2`     | Safe records plus bounded keyed prompt/config fingerprints    |

Output uses `[chathub-image-debug:<event>]` with schema version 1. Correlation
uses `x-chathub-image-diagnostic-id` across async dispatch only after the request
bearer matches the internal server secret. Unauthorized values are not logged or
reflected. Response status/header inspection does not clone or consume the body;
the dispatch client's normal JSON read creates the bounded fingerprint sample.
Records omit raw prompts, URLs, image data, response bodies, user/database IDs,
credentials, headers, cookies, environment values, arbitrary provider labels,
arbitrary error messages, and stacks. Provider values are represented by keyed
hash and length metadata. Unknown values are treated as off and emit a
structured `config_warning` without echoing the invalid value.

## Change guidance

If you add or rename environment variables, update all of these places together:

- `src/envs/llm.ts`
- `src/envs/app.ts` or `src/envs/serverDebug.ts` for app/debug variables
- `README.md`
- relevant docs under `doc/`
- runtime resolution in `src/server/modules/ModelRuntime/index.ts`
- any settings UI that exposes the option

## Key source references

- `README.md`
- `doc/credentials-login-flow.md`
- `src/envs/llm.ts`
- `src/server/modules/ModelRuntime/index.ts`
