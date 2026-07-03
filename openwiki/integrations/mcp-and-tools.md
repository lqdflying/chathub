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

## Key source references

- `src/services/mcp.ts`
- `README.md`
- `src/server/modules/`
- `src/server/routers/`
