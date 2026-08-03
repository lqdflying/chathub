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

The variants layout reads the current session with server-side Auth.js `auth()`
and passes that snapshot to `SessionProvider`. Supplying the `session` prop
prevents Auth.js from issuing an automatic `/api/auth/session` request after a
reload. Page navigation and ordinary `/api/auth/session` reads are
cookie-neutral: ChatHub removes `authjs.session-token`,
`__Secure-authjs.session-token`, and their chunked variants from `Set-Cookie`
while preserving unrelated cookies. OAuth callbacks, credentials login,
sign-out, and an explicitly marked keep-alive request remain able to change the
browser session cookie.

`SessionFreshnessPoller` calls the no-store `/api/auth/session-probe` endpoint
immediately after definitive session bootstrap and after an auth transition
finishes. Authenticated, online tabs repeat the probe every five minutes. The
endpoint returns a read-only `{ session }` snapshot. A confirmed missing or
different account remounts `SessionProvider` from that snapshot without
reloading the document or issuing an Auth.js client update. Network failures,
non-success responses, invalid JSON, and malformed sessions are inconclusive
and preserve the last confirmed state. Each request is bound to the identity
and auth-transition generation that started it; identity changes, transition
starts, and component cleanup abort or invalidate older work.

When the five-minute probe still matches the active account, the poller may send
one explicitly marked `/api/auth/session` keep-alive. That request is the only
session GET allowed to forward Auth.js's renewed session cookie. Keep-alives and
actual sign-in/sign-out writes share an origin-wide
[Web Lock](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
Auth transitions also publish a monotonic storage generation before waiting
for the lock, so an older probe cannot start or apply follow-up work. If a
replacement login begins during a keep-alive, it waits for the older write and
then lands last. Transition completion triggers read-only reconciliation in the
redirecting document and other open tabs. Redirecting OAuth transitions remain
pending through Auth.js's 15-minute state and PKCE transaction lifetime. ChatHub
sets an early marker before Auth.js performs provider lookup, CSRF retrieval,
and the OAuth sign-in POST. OAuth launchers request the authorization URL with
`redirect: false`; after that POST has created the
[state and PKCE cookies](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/lib/utils/cookie.ts),
ChatHub renews the shared marker while still holding the Web Lock and only then
navigates to the provider. The callback lifetime therefore starts from the
actual Auth.js transaction rather than the earlier button click. Auth.js also
refreshes the client session before a `redirect: false` sign-in returns. A
document-local OAuth phase prevents `UserUpdater` from mistaking that old-account
refresh for callback completion; only the new callback or error document may
clear the owned marker after session bootstrap finishes. Stale cleanup cannot
resume keep-alives before the Auth.js transaction itself expires.

If `localStorage` is unavailable, OAuth launch still proceeds with a rebased
document-local marker instead of treating the missing shared marker as
supersession. That document remains protected from its own keep-alive while it
navigates, but cross-tab coordination is necessarily unavailable without shared
storage. Browsers without Web Locks skip the background cookie-writing
keep-alive rather than issuing an unsynchronized write; explicit authentication
remains available.

The response filter uses the server-side
[`Headers.getSetCookie()` API](https://developer.mozilla.org/en-US/docs/Web/API/Headers/getSetCookie)
to preserve independent cookie headers and follows Next.js's documented
[middleware response-cookie model](https://nextjs.org/docs/app/building-your-application/routing/middleware#using-cookies).
This avoids the known client update and concurrent cookie-write limitations in
[next-auth#11958](https://github.com/nextauthjs/next-auth/issues/11958) and
[next-auth#8897](https://github.com/nextauthjs/next-auth/issues/8897).

This bounds stale client state and preserves sliding expiry without
reintroducing the unreliable foreground-resume request or Auth.js beta's
built-in polling path, which collapses fetch failures to `null`.
`UserUpdater` mirrors the provider snapshot into the user store and clears the
raw auth ID, NextAuth session/user, and mapped user identity together after a
confirmed sign-out.

ChatHub defaults `NEXT_AUTH_SSO_SESSION_STRATEGY` to `jwt`. Deployments that
explicitly select Auth.js database sessions retain Auth.js's upstream session
lookup limitation: an adapter failure can produce the same successful missing
identity as an absent session. The read-only probe removes false sign-outs
caused by browser-visible transport and response failures but cannot
disambiguate that server-internal database-session case.

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

### Development-only auth bypass

`resolveDevBypassUserId` is the single bypass resolver for Lambda tRPC and
WebAPI `checkAuth` routes, including `/webapi/files`. It is disabled unless
`NODE_ENV=development`. A request is accepted when either
`ENABLE_MOCK_DEV_USER=1` is set (no headers required) or both
`lobe-auth-dev-backend-api: 1` and a constant-time matching
`lobe-auth-dev-secret` for `AUTH_DEV_BYPASS_SECRET` are present. Both entry
points use `MOCK_DEV_USER_ID.trim()` and fall back to `DEV_USER`; they must not
substitute different owners for the same development request.

## File upload and object-storage ownership

Authenticated presigned PUT requests accept a filename and purpose, not a
caller-selected object key. The server creates keys under
`<file-root>/<sha256(userId)>/<hour>/<random>.<safe-extension>`; RAG evaluation
imports use the separate `ragEval/` root, while the password-gated Edge path
uses an `edge` scope. The account hash keeps raw database IDs out of object
names but is only a namespace, not an authorization credential.

When a new `files` row is registered, `createFile` requires a SHA-256 hash and
accepts only the current user's newly scoped file key.
If that content hash already exists globally, the canonical URL, MIME type,
size, and metadata from the global row win instead of trusting alternate
client values. Generated-media and avatar namespaces remain server-only. RAG
dataset import validates a current-user `ragEval` key before object storage is
read. Existing legacy rows and keys remain readable through their normal
database ownership checks; the scoped-key requirement applies to new uploads
and registrations rather than rewriting stored references automatically.

The authenticated app-file proxy can unwrap a root-relative path or an
absolute reference whose WHATWG `URL.host` matches `APP_URL.host`. `host`
includes the port but not the scheme, so HTTP and HTTPS references with the
same host and port are accepted; a foreign host is rejected. This is narrower
than arbitrary URL parsing but deliberately is not a strict `URL.origin`
comparison.

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

Output uses `[chathub-tools-debug:<event>]` followed by one versioned JSON object. The production parser maps this to `debug_namespace=chathub-tools-debug` and `debug_event=<event>`. An opaque `diagnosticId`, `spanId`, and per-span event sequence correlate tRPC, cache, OAuth, HTTP transport, MCP, normalization, serialization, direct server-database tool-result persistence, and browser response failures. Safe records include sanitized technical labels and credential-free endpoint paths, while user/connection identity remains hashed.

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
