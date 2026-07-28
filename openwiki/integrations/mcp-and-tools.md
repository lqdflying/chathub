# MCP and Tools

ChatHub treats tools as a first-class product area. It supports built-in tools, MCP discovery and invocation, and reporting/telemetry around tool usage.

## Main service surface

`src/services/mcp.ts` is the main app-facing service. It handles:

- invoking MCP tool calls
- resolving streamable MCP manifests
- resolving stdio MCP manifests for desktop mode
- checking whether an MCP server installation is valid
- reporting tool-call metadata asynchronously after execution

The service chooses between `desktopClient` and `toolsClient` depending on whether the app is in desktop mode and whether the target service is local/private.

## Product-level context

The root README positions Tools Hub as part of ChatHub's differentiation from upstream LobeChat. It mentions built-in tools such as:

- Picbed, backed by S3-compatible storage
- API Tester
- Password Generator
- an extensible sidebar for additional tools

The README also calls out MCP OAuth auto-discovery and server-side token storage as a major feature area.

## Built-in tools

Tools live under `src/app/[variants]/(main)/tools/` and share the left-side
tools navigation in `src/app/[variants]/(main)/tools/_layout/Desktop/Nav.tsx`.
The `tools` i18n namespace is sourced from `src/locales/default/tools.ts` and
served through `locales/en-US/tools.json` and `locales/zh-CN/tools.json`.

### API Tester

API Tester is a browser UI for composing HTTP requests, importing/exporting
cURL commands, and viewing responses. The client-side workspace lives under:

- `src/app/[variants]/(main)/tools/apitest/features/ApitestWorkspace/`
- request UI components in `RequestBuilder/`
- response UI components in `ResponsePanel/`
- pure helpers in `curl.ts`, `history.ts`, `helpers.ts`, and `queryParams.ts`

Requests are not sent directly from the browser to arbitrary third-party APIs.
The UI posts a normalized request payload to
`src/app/(backend)/webapi/tools/apitest/route.ts`, which validates it and calls
`src/server/services/apiTester/index.ts`. That service uses `ssrfSafeFetch` so
server-side requests keep the repository's SSRF protections.

Important invariants:

- Keep API Tester outbound requests behind `ssrfSafeFetch`.
- Propagate abort/timeout signals from the route into the outbound server fetch;
  otherwise canceling the UI request does not stop the upstream request.
- Do not store typed secrets in browser history. History entries are local-only
  convenience data and must be redacted before they are stored in `localStorage`.
  Redact bearer tokens, basic passwords, API key values, Authorization/Cookie
  headers, and query API key values.
- cURL import/export is best-effort, but supported flags should follow the
  official cURL behavior. `-G` / `--get` moves `-d` data into the URL query
  string, `--json` implies a JSON body with JSON content negotiation, and short
  options can attach their values (for example `-XPOST` and `-dfoo=bar`).
  Unsupported methods or ambiguous option combinations should fail import
  instead of silently changing request semantics.
- Body-capable methods are POST, PUT, PATCH, DELETE, and OPTIONS. Keep this
  consistent in the request editor, payload builder, cURL export, and server
  fetch service; GET and HEAD must remain bodyless.
- Normalize legacy browser history through the current request draft defaults
  before restore. Repair usable header rows, regenerate row identifiers, and
  discard entries with unsupported methods or unusable request shapes.
- Scope `Ctrl`/`Cmd` + `Enter` to the request workspace so modal and drawer
  interactions cannot send the underlying request. History actions must remain
  keyboard accessible.
- The response tabs are `Response Body` and `Response Headers`. Each new
  response returns to `Response Body` and resets its local view mode.
- Valid JSON defaults to an expandable `Tree` view, with `Formatted` and `Raw`
  alternatives. The tree uses Ant Design's named, virtualized tree primitive so
  its native focus and keyboard expansion behavior remain available. Root and
  first-level containers start expanded; deeper branches are user-controlled.
- Tree construction is bounded by `JSON_TREE_MAX_NODES` (2,000 nodes). Empty,
  non-JSON, malformed, and oversized payloads remain usable in text views;
  oversized valid JSON also shows a localized fallback explanation rather than
  rendering a partial tree.
- Copy uses pretty JSON in Tree/Formatted and exact response text in Raw.
  Download always preserves the exact original response body.

## What to watch for

MCP code is easy to break in ways that only show up in deployment-specific paths:

- desktop vs. server transport selection
- stdio vs. streamable transports
- OAuth-backed streamable transports must validate JSON-like HTTP responses before parsing. Both `application/json` and structured `application/*+json` media types are JSON. HTML auth/proxy pages returned as `text/html` or mislabeled JSON should become sanitized MCP connection errors without raw body text, URL query secrets, tokens, or `Unexpected token '<'` parser text.
- OAuth `401` recovery is bounded: the Streamable HTTP fetch may force one token refresh and retry the same request once. Concurrent `tools`, `resources`, and `prompts` calls share a single forced refresh; a failed refresh or second `401` is terminal.
- Token endpoint handling remains separate from transport retry. Authorization-code exchange and refresh still preserve provider-specific Basic-to-`client_secret_post` fallback while using the same malformed-response validation.
- MCP client cache keys are fingerprinted. OAuth connections use user + plugin identity and exclude rotating access tokens; simultaneous initialization is coalesced. Cache replacement, capability upgrades, eviction, and partial initialization failure disconnect the old/partial client best-effort.
- local/private URL handling
- manifest metadata and plugin installability
- custom plugin manifest proxying uses the authenticated `/webapi/proxy`
  boundary. `ToolService` creates one standard encrypted `X-lobe-chat-auth`
  header set and the manifest parser reuses it for both the manifest document
  and its nested OpenAPI document. Keep application credential creation outside
  `packages/utils`; inject proxy request options instead.
- async reporting that should not block the main tool call

## Tool call debug

`CHATHUB_TOOLS_DEBUG` is the provider-independent entry point for tool and MCP diagnostics. Set it on the server (container env) and recreate the service; no rebuild is needed.

```bash
CHATHUB_TOOLS_DEBUG=1       # structured safe metadata only
CHATHUB_TOOLS_DEBUG=verbose # safe metadata + structured payload fingerprints
```

Records use prefixed JSON: `[chathub-tools-debug:<event>] {json}`. In Axiom this populates `debug_namespace=chathub-tools-debug` and the event suffix as `debug_event`. Safe records contain structured technical metadata such as correlation IDs, sanitized labels and endpoints, counts, runtime/transport kind, terminal outcome, timing, result shape, and bounded fingerprints. Verbose payload views additionally bound arrays, object width, and depth; property names and every non-secret string become length + SHA-256 fingerprint metadata, while secret-key values are omitted.

Safe mode now follows an MCP request end to end with an opaque `diagnosticId`: browser RPC, tRPC route, client cache/initialization, OAuth lookup and refresh, HTTP or stdio transport, MCP protocol operation, result normalization, serialization, and the outgoing tRPC response. Events include a versioned envelope, a `spanId` plus per-span event sequence, connection hash, safe tool/procedure labels, duration, retry/timeout state, response status/media type/size, result shape, and bounded fingerprints. The browser failure report is a second span with the same `diagnosticId`, so its sequence restarts without becoming ambiguous. `mcp.callTool` is deliberately unbatched so one invalid gateway response cannot fail sibling tool calls; unrelated Tools procedures remain batchable.

When the browser cannot read or parse the Tools RPC response, it converts the raw exception into `client_rpc_response_failed`. The record reports a safe classification (`html`, `invalid_json`, `truncated_json`, `empty`, `unreadable`, or `network_error`), HTTP status, media type, byte count, HTML marker, structured network/error class, proxy hints, and a bounded response fingerprint when bytes were available. It never records the response body or messages such as `Unexpected token '<'`. The browser sends this strict metadata once to the authenticated `mcp.reportClientFailure` procedure so the failure also appears in container logs. Comparing the browser fingerprint with `tools_rpc_complete.response.responseFingerprint` identifies whether ChatHub produced the bad response or a downstream gateway replaced it.

In server mode, `mcp.callTool` receives the destination tool-message ID and persists the normalized result directly through the user-scoped `MessageModel` before returning. Its response contains the serialized `content` plus a persistence status: `persisted`, `failed`, or `client_required`. The browser applies a `persisted` result to its optimistic store without reposting the raw payload through `message.update`. A server-side `failed` result also remains available for the immediate model continuation, but the UI warns that a reload may lose it; ChatHub deliberately does not send the same large result through a second proxy boundary.

Every server-routed MCP invocation also carries a unique `invocationId`, including manual re-invocations. If the browser loses the `mcp.callTool` response after the server commits the tool message, it reads the matching recovery record immediately and, if the result is still pending or that read fails transiently, retries once after an abortable 500 ms delay. Both reads contain the tool-message ID and invocation ID. The server returns the result only when the stored pending invocation matches and has reached `persisted`; an older invocation can never recover or overwrite a newer attempt. The captured invocation signal is checked before recovery and error persistence, so browser aborts (including browsers that surface cancellation as `TypeError: Load failed`) do not become MCP gateway errors. This follows the [AbortSignal contract](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), where `aborted` records the operation's cancellation state.

Assistant tool calls are executed only after their final message write is confirmed. If both bounded finalization attempts receive an unusable gateway response, the UI keeps the streamed assistant state, reports the diagnostic failure, and stops before invoking external tools. This prevents side effects from running when the database may not contain the assistant's tool-call state; the user can retry the request explicitly.

Desktop stdio calls return `client_required` because their MCP router has no server database. That compatibility path still saves through `message.update`, isolates the update from the normal Lambda batch, reuses the MCP `diagnosticId`, and retries one classified response failure. `tool_persistence_rpc_started|complete|failed` and `client_rpc_response_failed` therefore remain useful for desktop/client-required persistence, while `tool_result_persistence_started|complete|failed` describe direct server-database persistence.

Parallel MCP calls use one abort controller per tool-message ID. Finishing one call removes only its own controller and loading ID; retry/rewind cancellation aborts the entire controller registry. This prevents one Tavily call completing from replacing or disabling cancellation for sibling `search`, `extract`, or `map` calls.

The common lifecycle also covers application built-ins, default plugins,
markdown plugins, standalone plugins, desktop MCP, and `AgentRuntime`
server-side tool execution. `tool_batch_started` records the expected call set;
`tool_completion_reported` records one terminal outcome per call; and
`tool_batch_settled` records `resultCount` and `failureCount`. Supported terminal
outcomes are `completed`, `failed`, `cancelled`, `skipped`,
`persistence_failed`, and `handed_off`. Diagnostic reporting is best-effort and
fire-and-forget, so logging or telemetry failures cannot change tool behavior or
delay the following model turn.

Tool diagnostics expose two independent server capabilities:
`toolLifecycleEnabled` follows `CHATHUB_TOOLS_DEBUG` and controls batch and
per-call lifecycle reports, while `cacheContinuationEnabled` follows the
provider-specific `DEBUG_*_CACHE=1` switches only when
`KEY_VAULTS_SECRET` or `NEXT_AUTH_SECRET` is also configured. This mirrors the
server-side fail-closed fingerprint requirement. Cache-only troubleshooting
therefore keeps the batch correlation, result/failure counts, and bounded result
summaries without enabling per-call lifecycle telemetry, but clients do not
collect continuation metadata when cache diagnostics cannot produce keyed
fingerprints. Capability discovery is best-effort: the client waits at most
250 ms, caches successful responses for 30 seconds, and does not permanently
cache rejected or timed-out requests.

Provider-native tools are not local completions. OpenAI web search, Moonshot
`$web_search`, Anthropic server tools, and Google grounding are classified as
`delegated`/`handed_off`; ChatHub's own web-browsing tool remains `builtin`.
This distinction prevents provider-side search from being counted as a
successful local result.

Useful phase events include `tools_rpc_started|complete|failed`, `tool_result_persistence_started|complete|failed`, `tool_persistence_rpc_started|complete|failed`, `client_cache_lookup`, `client_initialization_*`, `oauth_operation_*`, `transport_request_*`, `mcp_operation_*`, `call_tool_upstream_complete`, `call_tool_normalized`, `call_tool_complete`, and `client_rpc_response_failed`. `call_tool_upstream_complete` only means the MCP SDK returned; `call_tool_complete` is emitted after successful normalization, serialization, and the direct persistence attempt.

### Tool and cache correlation

For each tool batch, ChatHub derives stable synthetic `batchId` and
`continuationId` values plus a bounded 16-hex hash over the sorted, deduplicated
`tool_call_id` set. The internal continuation envelope contains only these
correlations, expected/result/failure counts, and bounded result summaries; raw
tool-call IDs, arguments, URLs, and result content remain outside diagnostics.

Client-dispatched completions are reported through
`telemetry.reportToolCompletion`. Each report contains its own call-ID hash and
`diagnosticId`, the shared batch correlation, a bounded result-shape summary,
runtime type, terminal outcome, and tool-name hash. Explicitly correlated nested
Tools RPC calls use isolated requests so parallel web-search, MiniMax-vision,
MCP, persistence, and telemetry operations cannot inherit a sibling's
diagnostic header. Uncorrelated Tools procedures remain batchable.

MCP `call_tool_complete` and `call_tool_failed` records inherit the same
per-call `diagnosticId` from the isolated Tools RPC request. The validated MCP
input also retains the bounded `batchId`, `continuationId`, tool-call set hash,
and settled result/failure counts, so MCP server completion can be joined to
the browser completion report and the following model request without logging
raw tool IDs, arguments, or results.

For every model provider, the same continuation correlation is removed from the
request body at the authenticated chat boundary and carried through typed
runtime options. Provider cache diagnostics attach it to `request`, `usage`,
`usage_missing`, or `terminal_error` records. No continuation or cache policy
metadata reaches upstream provider JSON; adapters also strip internal fields as
defense in depth. Effective cache policy is reconstructed server-side and never
merged from client-provided policy values.

OpenAI-compatible request history repairs tool-result blocks by assistant
occurrence, not by globally unique `tool_call_id`. A result with `parentId`
belongs to that assistant turn; legacy results without `parentId` are consumed
from a per-ID queue. This preserves repeated Kimi/Moonshot IDs across later
turns while ensuring each assistant tool call has one distinct, immediately
following tool result before the final provider request is fingerprinted.

The privacy boundary is invariant at both levels: no raw arguments, results, prompts, resources, HTTP/HTML bodies, arbitrary error messages, stdout/stderr, environment values, authorization/cookie values, OAuth codes/state/verifiers, or credentials. Secret-keyed fields are omitted rather than hashed. Safe mode may show sanitized tool/procedure labels and URL origin/path; URL userinfo/query/fragment are removed and secret-shaped path segments are hashed. Records are capped at 16 KiB, and payload-shape work is skipped while diagnostics are disabled.

Client-supplied `x-chathub-tools-diagnostic-id` values are never trusted as log
labels. Tools and Lambda ingress routes replace valid external IDs with
deployment-keyed HMAC fingerprints before installing the logging context; when
no fingerprint secret is configured, they use a fresh server-owned ID instead.
The response header carries the protected or server-owned value. Authenticated
client failure reports follow the same rule: without a fingerprint secret, the
event retains the report request's server-owned route ID and never reuses the
raw client ID. Cross-request correlation back to the original failed RPC
requires `KEY_VAULTS_SECRET` or `NEXT_AUTH_SECRET`.

The switch does not auto-enable existing `chathub-tools:*`, `lobe-mcp:*`, or `context-engine:*` debug namespaces and does not lower the global Pino level. Explicit `DEBUG=chathub-tools:safe|verbose` remains a legacy plain-text fallback when the corresponding event is not already emitted as structured JSON. See `openwiki/operations/auth-and-env.md` for the full value table and privacy notes.

## Change guidance

When editing tools or MCP behavior, check all three layers:

1. UI/settings surfaces under `src/app/[variants]/(main)/settings/provider/`
2. service code in `src/services/mcp.ts`
3. server/client transport implementations under `src/server/routers/` and `src/server/services/`

For built-in Tools Hub features, also check:

1. the route under `src/app/[variants]/(main)/tools/`
2. any matching backend route under `src/app/(backend)/webapi/tools/`
3. tests beside the feature and server service
4. all three `tools` locale sources

## Key source references

- `src/services/mcp.ts`
- `src/libs/mcp/http.ts`
- `src/libs/mcp/client.ts`
- `README.md`
- `src/server/services/mcp/`
- `src/server/modules/`
- `src/server/routers/`
- `src/app/[variants]/(main)/tools/`
- `src/app/(backend)/webapi/tools/`
