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

## LLM environment configuration

The main provider environment map lives in `src/envs/llm.ts`, which is referenced from the README as the canonical provider/env source. That config drives how server runtime code resolves keys and base URLs for providers like OpenAI, Anthropic, Azure, and provider-compatible gateways.

Moonshot supports `MOONSHOT_PROXY_URL` for a custom OpenAI-compatible base URL. Runtime precedence is request/user-provider `baseURL` first, then `MOONSHOT_PROXY_URL`, then the built-in `https://api.moonshot.cn/v1` default.

A notable recent change in `src/server/modules/ModelRuntime/index.ts` is special handling for Anthropic-compatible auth mode and proxy URL resolution. This makes provider configuration a live compatibility surface rather than a static list of keys.

## Deployment notes

The README presents Docker + PostgreSQL as the primary deployment target. Migrations run automatically in the container startup flow, and the README points readers to the Docker deployment wiki for upgrade procedures and troubleshooting.

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

## Change guidance

If you add or rename environment variables, update all of these places together:

- `src/envs/llm.ts`
- `README.md`
- relevant docs under `doc/`
- runtime resolution in `src/server/modules/ModelRuntime/index.ts`
- any settings UI that exposes the option

## Key source references

- `README.md`
- `doc/credentials-login-flow.md`
- `src/envs/llm.ts`
- `src/server/modules/ModelRuntime/index.ts`
