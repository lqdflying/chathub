# Architecture Overview

ChatHub is structured as a Next.js application plus a set of workspace packages that concentrate provider logic, context shaping, model metadata, and utility behavior. The repo intentionally separates runtime concerns from UI concerns so provider behavior can be reused across the app, server modules, and tests.

## Main layers

### App layer (`src/`)

The `src/` tree contains the user-facing app, server modules, services, stores, and UI features. High-signal areas include:

- `src/server/modules/ModelRuntime/index.ts` — resolves per-provider credentials and initializes the runtime
- `src/services/chat/contextEngineering.ts` — builds the final message list that gets sent to the provider
- `src/services/mcp.ts` — discovers and invokes MCP tools
- `src/envs/llm.ts` — provider environment configuration schema

### Shared packages (`packages/`)

The monorepo packages hold reusable logic. The main ones for understanding chat behavior are:

- `packages/model-runtime` — provider adapters, OpenAI-compatible streaming, and model/runtime abstractions
- `packages/context-engine` — processor pipeline for message rewriting, tool handling, and placeholder resolution
- `packages/types` — shared chat/provider data contracts
- `packages/const` — app-wide flags and constants
- `packages/utils` — shared helpers used by both app and runtime code

## Product boundaries

The root README frames ChatHub as a self-hosted alternative to upstream LobeChat with the following product priorities:

- production-friendly Docker deployment
- PostgreSQL as the durable backing store
- built-in authentication
- a larger supported model/provider matrix
- extended tools and memory behavior for long conversations

These priorities explain why the codebase has both UI features and a substantial server/runtime surface.

## Account-aware assistant navigation

Assistant selection treats the URL as the navigation request and
`SessionHydration` as the only URL-to-store activation boundary.
`useSwitchSession` closes the portal and routes immediately without first
writing an account-owned assistant ID into Zustand. Inbox is always routable.
Other IDs are accepted only when the current canonical account scope has
verified user-state ownership and the initialized session list contains the
assistant.

Hydration waits for both verified ownership and session-list initialization
before activating a non-inbox URL. A valid current-account deep link then
updates the session, agent, and chat stores. A missing ID is normalized to
inbox only after the initialized list confirms the absence. Store-driven
inbox resets and verified account changes block the displaced URL value while
the throttled History API update settles, so a stale query cannot resurrect an
assistant after account invalidation. `nuqs` rate limiting uses
`limitUrlUpdates: throttle(50)` rather than the deprecated `throttleMs`
option.

If authenticated user-state bootstrap fails, the default or searched assistant
list and its mutation controls are replaced by one account-scoped recovery
alert. A request failure offers **Retry**; an owner mismatch or unresolved
signed-in identity offers **Sign in again**. Inbox remains available throughout
recovery. Desktop and mobile create-assistant controls use the same bootstrap
status from `authSelectors.assistantCreationStatus`. Header controls, the Inbox
welcome plus button, empty-list add buttons, and group action menus remain
hidden until account ownership is ready, while unrelated navigation remains
available. An open group-creation wizard closes and clears its open state if
readiness is lost. Every Inbox click advances a synchronous assistant-hydration
cancellation generation before routing to `session=inbox` or starting the
optional desktop new-topic action. `SessionHydration` binds a pending assistant
query to the generation at which it was observed and refuses to activate it
after cancellation, even while the throttled URL update is still pending.

Account-dependent settings tabs also remain on their loading boundary while the
authentication provider is unresolved. They render only after authentication
has loaded and the resulting user scope is ready, or show the existing scoped
recovery action after a confirmed bootstrap failure. Account-independent tabs
such as About remain available during authentication loading.

## Cross-store synchronization

Zustand stores are constructed synchronously when their modules are evaluated.
Cross-store actions must not create a static dependency cycle between store
constructors, because client-component imports also participate in server
prerendering and can evaluate an action before its lexical declaration is
initialized. When synchronization is needed only after asynchronous data
arrives, import the concrete target store module inside that success path
instead of importing a broad store barrel at module scope.

Any account-scoped synchronization deferred across an `await`, including a
dynamic import, must capture and revalidate the complete account epoch: the
canonical scope, ownership invalidation generation, owner-mismatch state, and
the source store's scope generation. Comparing only the scope string does not
reject same-scope invalidation or an A-to-B-to-A transition. Revalidate the
epoch after every asynchronous boundary and before mutating the target store or
marking the source store initialized. This preserves both module initialization
order and account ownership when a user transition races with data loading.

Epoch validation must preserve liveness as well as reject stale work. Every
generation used to invalidate a fetch callback must be read through a reactive
store subscription and included in that fetch's cache key. A reset can then
change the key and start a replacement request for the new epoch; reading a
generation imperatively only inside the callback can reject the old response
without ever scheduling its replacement.

## Account-owned chat-group membership

A row in `chat_groups_agents` is valid only when its `userId` matches both the
referenced `chat_groups.userId` and `agents.userId`. The database enforces this
with composite parent keys on `(id, userId)` and composite foreign keys from the
junction table. `ChatGroupModel` repeats the invariant at the authorization
boundary: membership reads join through an owned group, owned junction row, and
owned agent, while writes validate every referenced agent and group in one
transaction. Mixed-owner or missing identifier sets fail atomically rather than
being partially inserted or silently filtered.

Ordinary and template-based creation both use one authenticated
`ChatGroupModel.createWithMembers` transaction. Existing member IDs are
deduplicated and validated before the group is inserted. Template virtual
members then create their agent, session, and `agents_to_sessions` link inside
that same transaction, followed by all `chat_groups_agents` memberships. A
failure in any of these five tables rolls back the entire group. The client
prepares complete virtual-session payloads in memory, merges the initiating
account's default-agent settings, and sends one request.

Plural member removal follows the same set-level rule. The model rejects empty
or duplicate input, verifies the owned group and every requested owned
membership, performs one scoped `DELETE ... RETURNING`, and compares the
deleted count before commit. A missing, foreign, or wrong-group identifier
therefore leaves every requested membership unchanged.

Template creation still captures canonical account scope plus the session and
chat-group store generations. It revalidates them before post-commit refresh,
analytics, or navigation, so an account or generation change suppresses stale
UI effects. These client checks limit stale work, but the transaction and
PostgreSQL constraints remain authoritative.

## Change guidance

When making architectural changes, check whether they need to flow through all of these layers:

1. environment/schema changes in `src/envs/llm.ts`
2. server runtime initialization in `src/server/modules/ModelRuntime/index.ts`
3. provider adapter changes in `packages/model-runtime`
4. context shaping changes in `src/services/chat/contextEngineering.ts` and `packages/context-engine`
5. UI or settings surface changes in `src/app/[variants]/(main)/settings/provider/`

## Key source references

- `README.md`
- `package.json`
- `src/server/modules/ModelRuntime/index.ts`
- `src/services/chat/contextEngineering.ts`
- `src/services/mcp.ts`
- `packages/model-runtime/package.json`
