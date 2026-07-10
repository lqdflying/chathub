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
  keyboard accessible, and response Body/Headers plus Raw/Formatted state
  should reset when a new response arrives.

## What to watch for

MCP code is easy to break in ways that only show up in deployment-specific paths:

- desktop vs. server transport selection
- stdio vs. streamable transports
- local/private URL handling
- manifest metadata and plugin installability
- async reporting that should not block the main tool call

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
- `README.md`
- `src/server/modules/`
- `src/server/routers/`
- `src/app/[variants]/(main)/tools/`
- `src/app/(backend)/webapi/tools/`
