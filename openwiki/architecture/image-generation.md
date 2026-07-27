# Image Generation

ChatHub's Image workspace is a server-mode feature at `/image`. It combines
provider/model configuration, prompt submission, generation topics, asynchronous
tasks, and generated-image management behind one responsive route.

## User interface surfaces

The route is selected with `SidebarTabKey.Image` and is controlled by the
`ai_image` feature flag (`showAiImage` in the client store).

- Desktop displays Image Settings on the left, the generation workspace in the
  center, and Image Topics on the right.
- Mobile uses the bottom navigation order Chat, Image, Me. The workspace remains
  in the main viewport; header actions open Image Settings in an 88dvh bottom
  drawer and Image Topics in a full-height right drawer.
- Discover remains a separate route and desktop action. It is no longer the
  middle mobile navigation item.

The Ant Design drawers provide focus trapping, Escape handling, close controls,
and focus return. Header actions expose `aria-controls` and `aria-expanded`.
Generation, batch, upload, replace, and delete actions remain visible on coarse
pointer devices instead of depending on hover.

## Client state and submission flow

`src/store/image/store.ts` composes four Zustand slices:

- generation config (provider, model, image count, and runtime parameters)
- generation topics
- generation batches
- create/recreate orchestration

`ImageWorkspace` owns configuration initialization so both desktop and mobile
wait for hydrated global status plus user settings and provider runtime state
owned by the active account before generation is available. This avoids mobile
submitting the store's initial hardcoded values while Image Settings remains in
its closed drawer.
`isInit` records that hydration has settled, while `isImageModelAvailable`
records whether the current configuration can generate. If no usable image
model is enabled, initialization settles with `isInit: true` and
`isImageModelAvailable: false`; Image Settings shows its provider/model guidance
instead of a loading skeleton, submission remains unavailable, and `imageNum`
is set to the user's current default rather than retaining the store's
hardcoded initial value.

For signed-in users, the remembered provider/model, image count, and a
model-supported `size` value are persisted to the DB-backed `users.preference`
record under `preference.imageConfig`, so they roam across devices. Writes go
through the user preference slice, which optimistically deep-merges the
hydrated `preference.imageConfig` state and serializes persistence by user ID.
This preserves interaction order, keeps later generic preference patches from
replaying stale image state, and prevents a queued callback from running under a
different account after an in-place authentication change. Persistence remains
fire-and-forget to image controls, so a sync failure never blocks generation
and does not stop later queued writes.

The dedicated `user.updateImageConfig` tRPC endpoint calls
`UserModel.updateImageConfig`. PostgreSQL merges the partial update directly
into the nested `preference.imageConfig` object with one `jsonb` expression;
generic preference patches likewise merge at the top level in the database.
There is no separate preference read before either update, so concurrent image
and unrelated preference writes preserve each other.

The client reads `preference.imageConfig` from hydrated user state. That DB image
config is authoritative for signed-in and local/no-auth users. Guests use only
the `LOBE_SYSTEM_STATUS` browser-local configuration. Historical browser values
have no trustworthy account owner because earlier releases also wrote them
while authenticated, so the client does not automatically migrate or promote
them into an account. The guest record is never deleted during sign-in and can
be restored on logout without risking assignment to the wrong account.
Automatic fallback selection is not persisted.

All account-owned data requests use the canonical auth scope: `guest`, `local`,
or `user:<raw-auth-id>`. User-state, provider-runtime, provider/model,
session/message/topic/thread, image history, chat-group, agent, file,
knowledge-base, installed-plugin, profile-statistics, and profile-ranking SWR
keys include that scope. Remote provider-model fetches re-check the originating
scope before writing model cards into persisted settings. Code Interpreter and
DALL-E file metadata keys also include the scope, and their callbacks compare
the chat reset generation before repopulating cleared maps.
Mounted components with account-owned local state use the same scope as a React
identity key or reset dependency. This includes profile API-key tables and
modals, SSO unlink state, and Picbed pagination and gallery state; a Zustand
reset alone cannot clear state owned by an already mounted component.

The stores clear account-owned in-memory data synchronously when the scope
changes, abort in-flight account operations, and increment store-local scope
generations. Every delayed Zustand action that can persist, dispatch, refresh,
clear loading state, or navigate captures the canonical scope and the owning
store's generation before its first await, then re-reads both after every await
before continuing. Resource identity is captured at the same boundary: remote
model discovery carries its original provider ID through persistence and
targeted refresh instead of consulting the provider that is active later.

This rule covers remote-model discovery, assistant-memory rollups,
session/group/thread creation and duplication, chat-topic creation and
duplication, image-topic create/delete/cover mutations, and delayed image, file,
knowledge-base, and plugin workflows. It also protects A-to-B-to-A account
transitions, where comparing only the scope string would accept work started
during the first visit to A. Invalidated creation actions return empty,
non-navigable identifiers, and stale `finally` blocks do not clear loading
markers owned by the current account. Knowledge-base, session, group, thread,
chat-topic, and image-topic callers must honor these cancellation results before
refreshing, inserting, summarizing, moving message maps, switching, or opening a
resource.
Conversation-bound chat actions capture the initiating session, topic, portal
thread, and thread source message in addition to account scope and generation.
Session and topic navigation invalidate the conversation before new data is
hydrated: active generation controllers are aborted, the conversation epoch is
incremented, and transient message/tool/reasoning state is cleared. Client and
server generation paths carry the immutable epoch plus originating session and
topic through message creation, stream callbacks, persistence, refresh, and
finalizers. Thread sends follow the same rule and stop after any ownership
change instead of refreshing or reopening another conversation. A stale
finalizer cannot clear a controller or loading marker owned by a newer
conversation.

Server-mode chat generation also captures the canonical account scope before
message persistence. After the agent runtime settles, it revalidates that scope,
the conversation epoch, the session, and the topic before reading user-file
state or attaching files to an agent. Generation loading is tracked separately
from title and topic-update loading in a two-level operation registry. The outer
key is the captured session/topic conversation key; its value is a bucket keyed
by unique generation operation IDs. Concurrent runtimes for the same topic
therefore remain independently owned, and the topic stays loading until the
last operation in its bucket settles. Each finalizer removes only its own
operation ID and deletes the outer bucket only when no siblings remain.
Conversation invalidation drops the complete active bucket while preserving
other session/topic buckets. A stale finalizer whose operation was already
invalidated cannot remove a newer operation created under the same outer key.
Global history and account resets clear the complete registry. Agent-file
persistence similarly captures the account generation, session, and agent
before its first await and skips refreshes when any owner changes.

Topic and thread title summaries have resource-specific operation tokens and
abort controllers. Their optimistic title and loading state are written to the
captured session/topic map instead of whichever map is active when a callback
runs. Invalidation aborts the stream, removes only operation-owned loading IDs,
and restores the original title only while the displayed title still matches
that operation's output. Final database writes are serialized per resource and
scope, so an older write that already started must settle before a newer title
is persisted; the newer title therefore remains authoritative during concurrent
or A-to-B-to-A summary sequences.

Picbed uses the same account scope as a React identity key, aborts active uploads
when that scope unmounts, and checks scope before every file, after object
storage upload, and before record creation. The scope and `AbortSignal` continue
through pre-signing and the tRPC mutation. The server compares the requested
scope with the raw authenticated identity before inserting a Picbed record, so
an object uploaded for account A cannot be registered to account B after an
in-place account switch.

Telemetry-consent SWR entries use `['checkTrace', currentUserScope]`; no entry is
read while authentication scope is unresolved. This prevents one account's
cached prompt decision from controlling the notification rendered for another
account.

Image batch creation additionally verifies topic ownership in the server
transaction before inserting account-owned rows. Controller registries remove
an entry only when they still own that exact controller, so completion of an
older same-identifier operation cannot delete a newer operation's cancellation
handle. These boundaries prevent prior-user messages, histories, statistics,
rankings, generated-file metadata, drafts, file attachments, knowledge bases,
installed plugins, agent configuration, enabled models, and decrypted key
vaults from appearing after an in-place account switch.

Direct draft-clearing helpers follow the same rule: after awaiting message
persistence, they clear `inputMessage` only if the active session, topic,
thread, and conversation generation still match the initiating send. A stale
completion may clean up its own server artifact, but it must not erase a draft
typed in the new account or conversation.

The raw authentication identity is tracked separately from the database data
owner. This keeps Clerk development impersonation valid: cache ownership and
stale-response checks use the raw Clerk ID, while the returned mapped user ID
continues to identify the database owner. While authentication is unresolved,
common user flags and account-owned stores reset to defaults. Image
initialization waits for both user state and provider runtime to be ready for
the same canonical scope; local/no-auth mode therefore uses `local`, and direct
account switches keep the workspace unavailable until the new scope is ready.

Client-mode `LOBE_PREFERENCE` read-modify-write operations use the Web Locks API
with one origin-wide lock name. A same-tab promise queue continues to serialize
ordinary local writes in non-locking runtimes.

Only these preference fields are restored; prompts, seeds, reference images,
width/height, aspect-ratio edits, and other runtime parameters remain transient.
Restore validates the count against the request range of 1 through 50 and
validates size against the active model schema.
For models without a discrete `size` parameter, persisted `null` and missing
size are equivalent and do not trigger a rebuild that would discard transient
width, height, or aspect-ratio edits. For models with a discrete `size`
parameter, persisted `null` means the model's declared default size and replaces
any stale concrete size still held in memory.
Missing, stale, or unsupported values use the user's default count and current
model defaults. A removed, disabled, or unusable remembered model falls back to
the first usable enabled image model while retaining a valid remembered image
count. This automatic fallback changes only the active runtime configuration and
does not replace the remembered provider/model preference. Usability requires
the model's parameter schema to produce a valid generation configuration;
schema-less entries remain in provider infrastructure state but are skipped by
image configuration resolution. The model selector uses this same usability
check, omits invalid entries, and shows the provider settings guidance when no
child can produce a configuration. It also rechecks usability before dispatching
selection to protect against provider-list changes between render and
interaction. A draft prompt typed
before asynchronous initialization completes is carried into the restored
configuration and is never persisted. The enabled provider/model list and each
model's parameter schema are part of the reactive configuration signature.
Disabling the active selection switches to the first usable enabled image model.
Changing a same-ID model schema rebuilds defaults and removes values the updated
schema no longer supports. If no model is available, later provider updates can
recover the settled configuration without reloading the workspace. Recovery
prefers the remembered provider/model when it becomes usable, keeps the draft
prompt, restores only valid persisted count and size preferences, and otherwise
uses the user's current default count plus the newly available model's parameter
defaults. Manual selection or settings reuse of a usable model restores
`isImageModelAvailable`. Reselecting the retained provider/model during manual
recovery rebuilds its current parameter defaults while preserving the draft
prompt.

The prompt input rejects empty and whitespace-only values and blocks submission
until configuration initialization has completed and a usable model is
available. Submission trims the prompt,
creates a topic when needed, sends the request through `imageService`, refreshes
an existing topic, and clears only the prompt that was actually submitted. All
topic and service failure paths reset both `isCreating` and
`isCreatingWithNewTopic`; the UI reports submission failure with a localized
message.

## Server request and task flow

`src/server/routers/lambda/image/schema.ts` is the shared boundary for
`image.createImage`. It requires:

- non-empty, trimmed topic, provider, model, and prompt strings
- an integer image count from 1 through 50
- the existing runtime parameter object

The route shape and database schema are unchanged. The mutation converts
reference-image URLs to object-storage keys, rejects a configuration that would
persist a full URL, and creates the generation batch, generation rows, and
asynchronous task rows in one database transaction. It then dispatches the
background image tasks through the async caller.

Server-to-server async dispatch resolves `/trpc/async` with an internal origin:
explicit `INTERNAL_APP_URL`, then Docker loopback
`http://127.0.0.1:${PORT || 3210}` when local container rewriting is enabled,
then public `APP_URL`. `APP_URL` remains the public/canonical URL for browser,
OAuth, webhook, and link-generation behavior. An explicit internal URL is valid
only when it is a root HTTP(S) origin without credentials, path, query, or
fragment; invalid values use the existing fallback chain.

Image submission remains non-blocking. Each detached dispatch promise has a
rejection handler; transport failures mark only tasks still in `Pending` as
`Error` with `TaskTriggerError`. Tasks already `Processing`, `Success`, or
`Error` are not overwritten, so ambiguous transport failures cannot race a task
that already started. The async worker likewise claims `Pending -> Processing`
atomically and exits before provider initialization when the claim fails. A
late or duplicate dispatch therefore cannot revive an errored task or generate
the same task twice.

The user setting `MAX_DEFAULT_IMAGE_NUM` remains 20; it is a settings boundary,
not the per-request generation limit.

## Structured diagnostics

`CHATHUB_IMAGE_DEBUG` enables server-only prefixed JSON diagnostics for the core
image path. `1`/`safe` records lifecycle metadata; `2`/`verbose` adds keyed
fingerprints whose strings, arrays, object width, depth, and output size are
bounded. The event chain covers submission acceptance, batch persistence,
dispatch start/settlement, async route start/settlement, provider call,
async task start, transform, upload, and task-status settlement. Each
authenticated async HTTP request emits one `async_route_started` record and
exactly one
`async_route_settled` record whose outcome reflects tRPC errors and HTTP status.

Diagnostics propagate an opaque `x-chathub-image-diagnostic-id` header only
when the async request presents the internal server bearer secret. External,
malformed, or unauthorized headers are neither logged nor reflected. The ID is
not returned to public clients and is not stored in the database.

Async route diagnostics inspect response status and headers without consuming
or cloning the body. The dispatch client samples a bounded prefix only while its
normal `json()` call consumes the response once. `bodyKind` describes the
observed media/prefix independently from `fingerprintTruncated`, which indicates
only that the response sample reached its byte limit. If response body
consumption fails after headers arrive, `dispatch_http_parse` emits a failed
record with `failurePhase=response_read` and status/media metadata; intentional
request aborts, identified by an aborted request signal or the exact
`AbortError` class, do not emit this failure record. Error message text is never
used to infer cancellation. Recognized runtime error classes remain readable;
arbitrary `Error.name` values normalize to `OtherError`. Records must not include
raw prompts, URLs, image data, response bodies, user IDs, database IDs,
credentials, headers, cookies, environment values, arbitrary error messages, or
stacks. Arbitrary provider strings are emitted only as keyed hash and length
metadata.

## Retry safety

Recreate is replacement-first:

1. Validate the active topic and original generation batch.
2. Submit the replacement using the original batch's provider, model,
   configuration, and generation count.
3. Remove the original only after replacement submission succeeds.
4. Refresh batches regardless of success or failure.
5. Clear the busy state and preserve the primary error.

This may leave both batches visible if cleanup fails, but it does not destroy
the user's failed batch before a replacement has been accepted.

## Source map

- `src/app/[variants]/(main)/image/_layout` — responsive route layouts
- `src/app/[variants]/(main)/image/features` — prompt and generation workspace
- `src/app/[variants]/(main)/image/@menu` — provider/model and parameter controls
- `src/app/[variants]/(main)/image/@topic` — generation-topic navigation
- `src/store/image` — image state and orchestration
- `src/services/image.ts` — client tRPC service
- `src/server/routers/lambda/image.ts` — persistence and async task dispatch
- `src/server/routers/async/caller.ts` — internal async origin and dispatch headers
- `src/server/routers/lambda/image/schema.ts` — request validation and config guard
- `src/server/routers/lambda/user.ts` (`updateImageConfig`) — DB-backed image preference writes
- `src/services/user/{server,client,type}.ts` — image preference update wiring
- `src/hooks/useFetchAiImageConfig.ts` — scoped preference read and hydration

## Verification

High-signal coverage includes mobile navigation/drawers, prompt and busy-state
failure paths, replacement-first retry ordering, request-schema boundaries, and
the image generation configuration slices. Legacy ComfyUI transformer tests use
test-local model schemas so removed provider exports are not restored.

Run the targeted image Vitest suites, the ComfyUI service tests when transformer
fixtures change, and `bun run type-check`. Follow the repository constraints in
[Testing and Change Checklist](../testing.md).
