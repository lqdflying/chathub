# Image Generation

ChatHub's Image workspace is a server-mode feature at `/image`. It combines
provider/model configuration, prompt submission, generation topics, asynchronous
tasks, and generated-image management behind one responsive route.

## User interface surfaces

The route is selected with `SidebarTabKey.Image` and is controlled by the
`ai_image` feature flag (`showAiImage` in the client store).

- Desktop displays Image Settings on the left, the generation workspace in the
  center, and Image Topics on the right.
- Desktop places the durable **Artifacts** destination immediately below Tools
  in the global navigation. Mobile uses the bottom navigation order Chat,
  Image, Artifacts, Me. The workspace remains
  in the main viewport; header actions open Image Settings in an 88dvh bottom
  drawer and Image Topics in a full-height right drawer.
- Discover remains available to existing direct links, but it is no longer a
  desktop or mobile navigation action and is excluded from search indexing.

The Ant Design drawers provide focus trapping, Escape handling, close controls,
and focus return. Header actions expose `aria-controls` and `aria-expanded`.
Generation, batch, upload, replace, and delete actions remain visible on coarse
pointer devices instead of depending on hover.

Global navigation uses the public `/artifacts` URL. That path must remain in the
Next.js middleware matcher so middleware can rewrite it to the serialized
locale, device, and theme variant before App Router resolution.

## Artifacts and history housekeeping

`/artifacts` is a separate, account-scoped gallery backed by `files.source =
image_generation`. `FileModel.queryImageArtifacts` filters by the authenticated
user and image MIME type, applies bounded search/sort/pagination, and returns
UI-resolved URLs plus optional dimensions from file metadata. The route is
read-only: generated originals are created by the existing generation ingestion
transaction and remain durable after topic history is cleaned.

Image history housekeeping is deliberately owned by the Image Topics surface,
not by Artifacts. `GenerationTopicModel.previewHousekeeping` reports eligible
and active-topic counts for either `all` or an `olderThan` cutoff. The mutation
starts a transaction, locks the candidate topic rows, reloads their latest
topic/batch/generation/task activity, and only then deletes eligible topics.
Pending and processing tasks are skipped. Image submission obtains a compatible
share lock on the topic row, so a submission and cleanup cannot silently race.

The housekeeping dialog defaults to the 30-day cutoff and maps the 1-, 7-, and
30-day presets directly to the existing `olderThan.days` input. **Custom** accepts
an integer from 1 through 3650; an empty or invalid value suppresses preview and
submission. **All history** sends `{ mode: 'all' }` and hides the age controls.
The live preview remains visible, while the deletion-scope explanation is
available from the accessible help popover. The footer has equal-width
**Cancel** and **Delete history** actions.

Topic deletion cascades the topic, batch, and generation records. The model
returns only disposable topic covers and generation thumbnail keys for
best-effort object-storage cleanup. It excludes every URL represented by the
generation asset or its durable `files` row, preserving originals even when
legacy metadata reuses a thumbnail or cover key. The router omits deletion keys
from its public response and treats storage cleanup failure as non-fatal after
the database transaction commits.

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
`ImageWorkspace` also mounts `TopicUrlSync` independently of the Image Topics
navigation slot and uses the store's `activeGenerationTopicId` as the canonical
render state. The URL remains the deep-link and browser-navigation adapter, but
closing or never opening the mobile Topics drawer cannot suspend topic
synchronization, batch loading, or generation-status polling.
Topic creation likewise does not depend on the drawer-owned topic-list SWR
consumer. As soon as the server returns the permanent topic ID, the generation
topic slice atomically promotes the optimistic temporary row to that ID before
requesting revalidation. The title summarizer and `switchGenerationTopic` can
therefore resolve the permanent topic even when SWR revalidation has no mounted
consumer.
Generated topic titles are a plain-text contract. The client removes surrounding
Markdown emphasis before optimistic display and persistence, while topic-list
hydration applies the same normalization to historical stored titles. The title
prompt also explicitly forbids Markdown, but correctness does not depend on the
model following that instruction.
`isInit` records that hydration has settled, while `isImageModelAvailable`
records whether the current configuration can generate. If no usable image
model is enabled, initialization settles with `isInit: true` and
`isImageModelAvailable: false`; Image Settings shows its provider/model guidance
instead of a loading skeleton, submission remains unavailable, and `imageNum`
is set to the deployment default rather than retaining the store's
hardcoded initial value.

### Configuration bootstrap recovery

`useFetchAiImageConfig` continues to wait for three prerequisites owned by the
active canonical scope: browser system status, user state, and provider runtime
state. It is now mounted globally in `StoreInitialization` so the config hydrates
for every session — the built-in chat Image tool depends on this (see _Chat Image
tool_ below). The initializer is idempotent (it no-ops once `isInit` is set), so
the additional `ImageWorkspace` mount is harmless; the desktop panel and mobile
drawer only render the resulting loading, failure, or settled state.

User-state and provider-runtime request failures are stored as category-only
records tagged with the requested scope. User hydration can report
`request-failed` or `owner-mismatch`; provider runtime reports
`request-failed`. The stores do not retain credentials, response bodies, raw
server errors, or other request details. These records represent bootstrap
failure only: after the active scope has accepted user/provider runtime state,
a later SWR focus, reconnect, or explicit refresh failure preserves that
last-known-good state and does not replace working controls with bootstrap
guidance. An `owner-mismatch` is the exception because it proves that the
authenticated scope and returned identity have diverged. It clears hydrated
user preferences, settings, provider/model lists, subscription state, and
mapped user data even after earlier successful hydration. The mismatch also
increments a monotonic ownership-invalidation generation and publishes an
immediate account-scope invalidation event. `StoreInitialization` consumes that
event through `resetAccountScopedStores`, which synchronously clears the
session, chat, image, agent, group, provider runtime, file, knowledge-base, and
tool stores; increments their account or conversation generations; and aborts
registered chat, topic/thread title-summary, image, upload, agent-update, and
plugin operations before their controller references are cleared. The generation
change provides the same reset when the event subscriber has not mounted yet.

Provider and model SWR callbacks check both their originating scope and the
active owner-mismatch state before writing. Authentication payload and header
construction also fails closed during the mismatch, so cleared or late runtime
credentials cannot be serialized into a request. Image creation and recreation
register an `AbortController` with the image store, pass its signal to the tRPC
mutation, and include ownership validity in every continuation check. A
mismatch therefore cancels the request and suppresses stale batch refresh,
removal, prompt clearing, and finalizer writes.

The shared account-aware SWR wrappers recognize canonical `guest`, `local`, and
`user:<raw-auth-id>` scopes in account keys, then append the user store's
`ownershipInvalidationGeneration` without changing existing key positions
consumed by fetchers. They set the effective key to `null` when the requested
scope is no longer current or an owner mismatch is active, and suppress
success/error callbacks when the captured scope or generation is stale.
`resetAccountScopedStores` removes all epoch-tagged account entries from the
global SWR cache without revalidation; focus or reconnect therefore cannot
refill a cleared store with data returned under the mismatched server session.
Imperative refreshes use `mutateAccountSWR`, which requires the requested scope
to be current, targets the current epoch-tagged key, and does nothing while
ownership is invalid. Broad refreshes that intentionally cover several mounted
keys use `mutateAccountSWRByPredicate`; the shared boundary first limits SWR's
predicate scan to the current canonical scope and ownership epoch, then applies
the operation-specific predicate. This preserves multi-list refresh behavior
without revalidating stale account generations. SWR applies global mutation
predicates to [all existing cache keys](https://swr.vercel.app/docs/mutation#mutate-multiple-items),
so account-owned actions must not call raw predicate `mutate` directly.
User-state bootstrap uses the same epoch key directly to avoid a store import
cycle and remains disabled for a same-scope hard mismatch. Its SWR request uses
`dedupingInterval: 0`: after account-scoped cache clearing and a
`user:A → unresolved → user:A` remount, the newly mounted initializer must
start a replacement request even if the previous same-key request settled
within SWR's normal deduplication window. Scope, ownership-generation, and
owner-mismatch checks still reject stale responses.

User-owned mutations use the same fail-closed boundary. Settings, avatar,
preference, image-config migration/update, model-provider configuration, and
SSO unlink actions capture canonical scope, ownership generation, and current
data owner before their first local write. Each direct persistence operation
registers an `AbortController` in the user store and passes its signal through
the user service to the tRPC mutation. Account invalidation aborts both the
legacy debounced settings controller and the shared controller pool before
clearing their references. Queued image-config writes re-check ownership when
they reach the front of the queue, and every post-await continuation checks
both the captured identity and the signal. A mismatch can therefore neither
start a new optimistic user mutation nor let an in-flight or queued mutation
refresh or overwrite the next account's state.

A scope reset, matching request-failure retry, or accepted success clears the
matching recoverable failure. An owner mismatch remains active until the
authentication session changes; it is not recoverable by revalidating the same
resource. Late success and error callbacks whose request scope is no longer
active are ignored, so an account transition cannot hydrate or report another
account's state.

Image Settings renders the skeleton only while prerequisites are genuinely
pending or a retry is active. An active-scope prerequisite failure replaces the
skeleton with compact guidance and **Retry**. Retry revalidates only the failed
current-scope user/provider resources; success lets the existing initializer
settle the image configuration, while another failure restores the guidance in
the already-open mobile drawer. Retry loading is tagged with the canonical scope
that initiated it, so an account transition immediately renders the new scope's
loading, error, or settled state without waiting for the previous request. An
authenticated state whose canonical scope cannot be resolved shows sign-in
guidance without offering a request retry. An owner mismatch similarly never
offers **Retry**: Image Settings shows identity-specific guidance and **Sign in
again**, which uses the universal logout flow so the authentication provider can
establish a new session. The normal no-model guidance remains a settled
image-configuration state and is not classified as a bootstrap failure.

The same bounded failure contract wraps settings tabs that require hydrated
user state. While the active-scope request is pending they keep their existing
loading UI. A `request-failed` state offers **Retry** through
`refreshUserState`; an owner mismatch or signed-in identity whose scope remains
unresolved offers **Sign in again**. The guard includes General, Chat
Instruction, Default Assistant, legacy LLM, AI Provider, TTS, Hotkeys,
System Assistant, MCP, and Storage so account-owned mutations cannot silently
no-op or report success before ownership is verified. Account-independent
pages such as About and desktop Proxy remain usable.

### Image Settings scroll layout

Every configuration control is a normal-flow child of the same scroll
container. **Number of Images** is the final item after Model, reference image,
Size, Quality, dimension, Steps, CFG, and Seed controls, with ordinary bottom
spacing on the container. It is not sticky or fixed and has no observer-driven
overlay, negative margins, or reserved magic-height padding. Mobile drawers and
desktop panels therefore scroll the complete ordered form without controls
moving underneath the image-count selector.

Browser system status is advisory preference data. If
`LOBE_SYSTEM_STATUS` is missing, inaccessible, or contains malformed JSON,
initialization awaits the asynchronous storage read, treats a rejected read as
empty preferences, retains `INITIAL_STATUS`, and marks status hydration
complete. The `AsyncLocalStorage` constructor also treats its legacy
`LOBE_GLOBAL` migration as best-effort: denied `localStorage` access and
malformed legacy JSON cannot throw during store-module import. Invalid legacy
data is preserved rather than destructively removed; a valid legacy preference
continues to migrate. This follows the documented
[`JSON.parse` failure contract](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse);
the user/provider retries continue to use the existing
[SWR mutation and error lifecycle](https://swr.vercel.app/docs/api).

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

The first-use image count is separate from user settings. Image bootstrap reads
`GlobalServerConfig.image.defaultImageNum`, which is populated from
`AI_IMAGE_DEFAULT_IMAGE_NUM` and falls back to `DEFAULT_IMAGE_CONFIG` (`4`).
That deployment default is passed explicitly into initialization and
revalidation for signed-in, local, and guest scopes; a valid remembered count
always wins. The former `UserSettings.image.defaultImageNum` field is no longer
hydrated, imported, exported, or accepted by settings updates. Its historical
`user_settings.image` database column and migration remain in place as inert
compatibility data, so this retirement requires no destructive migration.

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
keys include that scope and the ownership-invalidation epoch. Remote
provider-model fetches re-check the originating scope before writing model cards
into persisted settings. Code Interpreter and DALL-E file metadata keys also
include the scope, and their callbacks compare the chat reset generation before
repopulating cleared maps.
Mounted components with account-owned local state use the same scope as a React
identity key or reset dependency. This includes profile API-key tables and
modals, SSO unlink state, and Picbed pagination and gallery state; a Zustand
reset alone cannot clear state owned by an already mounted component. API-key
and Picbed list components use the sensitive verified scope rather than the raw
authentication scope. They defer their initial request while authenticated user
state is unverified, then the selector changes from `undefined` to
`user:<raw-auth-id>` after matching hydration and naturally remounts/reloads the
list without requiring a page remount.

The stores clear account-owned in-memory data synchronously when the scope
changes, abort in-flight account operations, and increment store-local scope
generations. Every delayed Zustand action that can persist, dispatch, refresh,
clear loading state, or navigate captures the canonical scope and the owning
store's generation before its first await, then re-reads both after every await
before continuing. Resource identity is captured at the same boundary: remote
model discovery carries its original provider ID through persistence and
targeted refresh instead of consulting the provider that is active later.

Imperative account mutations share the fail-closed boundary in
`src/store/accountMutation.ts`. `captureAccountMutationSnapshot` returns no
snapshot while the canonical scope is unresolved, an active `owner-mismatch`
exists, or an authenticated `user:*` scope has not completed user-state
hydration for that exact scope. The last condition requires both
`isUserStateInit` and `userStateScope === scope`; a raw authentication scope is
not proof that the browser state and server session agree. A newly invoked
action must therefore stop before preprocessing, optimistic state, loading
markers, network requests, or persistence. `isAccountMutationCurrent`
rechecks the same verified scope, ownership generation, and mismatch state for
every asynchronous continuation. Domain stores layer their own scope or
conversation generation, resource identity, and operation/controller
ownership over that shared predicate.

Nested and staged workflows propagate the originating snapshot or checkpoint;
they never capture a fresh snapshot after an await. This applies to
upload-to-record flows, file parse/embedding launches, RAG dataset imports,
remote-model fetch-and-persist operations, topic/title workflows, and
plugin/MCP discovery-check-install-report sequences. Each stage rechecks the
originating checkpoint before the next irreversible call, and operation-owned
finalizers release only their own loading marker or controller. Recapturing
inside a nested stage would incorrectly legitimize a parent operation that was
invalidated during an account reset.

Direct account-sensitive Lambda callers use the same contract at the transport
boundary. The Lambda client routes `apiKey.*` and `picbed.*` through an
isolated verified-account link that requires a sensitive account snapshot,
explicitly rejects `guest`, and aborts before authentication headers or network
fetch when ownership is unresolved or unverified. The link sends the captured
scope in `X-ChatHub-Account-Scope`. Shared server middleware on every
`apiKey.*` and `picbed.*` procedure treats that header as an untrusted claim and
compares it with the trusted raw request principal (Clerk ID, NextAuth ID, OIDC
subject, or bearer-validated `rawAuthUserId`) before database or model setup.
Token auth derives that principal from server-side `AUTH_USER_ID` only after
constant-time validation of `Authorization: Bearer <AUTH_TOKEN>`; the legacy
`X-token-auth-user` request header is ignored. Authenticated deployments accept
only `user:<raw-auth-id>`; no-auth deployments accept only `local`. Missing,
`guest`, malformed, or foreign claims fail closed. The claim never selects a
database owner, and mapped database owner IDs remain separate from the raw
authentication identity. User-state bootstrap remains outside that gate so
`user.getUserState` can establish verification without deadlocking.
Picbed upload additionally captures the snapshot before its separate S3 stage
and rechecks it before record creation. This follows tRPC v11's documented
[per-request dynamic headers](https://trpc.io/docs/client/headers) and
[request-derived server context](https://trpc.io/docs/server/context) pattern;
authorization remains in shared server middleware rather than in the
client-supplied header.

Server-side authorization remains authoritative. `ChunkModel.semanticSearch`
and `semanticSearchForChat` constrain the root chunk, embedding, file-chunk
edge, and file metadata joins to the authenticated database owner. Optional or
client-supplied file IDs are applied only to that owner-qualified file join, so
omitting the filter, passing a foreign ID, or mixing owned and foreign IDs
cannot return another account's chunk text or filename. This follows OWASP's
[deny-by-default authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#deny-by-default)
and its requirement to enforce
[object-level authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
where records are accessed.

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

Picbed hosts both images and videos. It uses the same account scope as a React
identity key, aborts active uploads when that scope unmounts, and checks scope
before every file, after object storage upload, and before record creation. The
scope and `AbortSignal` continue through pre-signing and the tRPC mutation.
Shared media validation accepts only `image/*` and `video/*`; videos are capped
at 20 MiB inclusive in the client before S3 upload, and the Lambda create input
repeats that check against client-reported metadata. The Lambda procedure does
not inspect S3 object metadata. Shared transport middleware compares the
asserted scope with the raw authenticated identity before every Picbed list,
delete, or create procedure, while record creation requires a storage key from
the authenticated database owner's generated upload prefix. Existing legacy
records remain readable. An object uploaded for account A therefore cannot be
newly registered to account B after an in-place account switch.

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

### GPT Image 2 size contract

The `openaicompatible` `gpt-image-2` card has a dedicated size schema. It keeps
`auto` and the standard `1024x1024`, `1536x1024`, and `1024x1536` presets, and
adds `2560x1440` / `1440x2560` QHD presets plus `3840x2160` / `2160x3840` UHD
presets. Other providers and image models retain their existing fixed-enum,
width/height, or aspect-ratio controls.

`packages/model-bank/src/standard-parameters/index.ts` defines the optional
custom-size metadata and the shared `validateImageSize` helper. A valid custom
value remains a canonical `WIDTHxHEIGHT` string and must meet all of these
conditions:

- both edges are positive multiples of 16
- neither edge exceeds 3840 pixels
- the long-edge to short-edge ratio is no greater than 3:1
- total pixels are between 655,360 and 8,294,400 inclusive

The size control reads the model metadata to render Standard, 2K, and 4K groups
plus a Custom editor. Custom width and height remain local draft state until
confirmation succeeds, so a synthetic `custom` value is never persisted or
sent to a provider. The 2K presets contain 3,686,400 pixels and remain within
the reliable range. Any preset or custom value above that threshold is valid
but displays the experimental warning.

Generation configuration persistence uses the same validator for both
DB-backed account preferences and guest browser state. Valid custom strings
therefore persist and restore like presets; malformed, stale, or out-of-range
values fall back to the model's `auto` default.

The public `image.createImage` input schema applies the contract only when
`provider === 'openaicompatible'` and `model === 'gpt-image-2'`. Omitting
`params.size` remains valid and uses the provider default. The OpenAI-compatible
runtime repeats the same scoped validation before invoking the client, removes
`auto` from the upstream request, forwards valid preset and custom strings
unchanged to both generation and edit calls, and rejects invalid values before
any provider request or reference-image download. The database schema is
unchanged because image preferences and generation configurations already
store `size` as a string.

The limits and curated presets follow the OpenAI
[Image generation guide](https://developers.openai.com/api/docs/guides/image-generation),
[GPT Image 2 model page](https://developers.openai.com/api/docs/models/gpt-image-2),
and [GPT Image 2 size guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide#gpt-image-2-size-options).

For models without a discrete `size` parameter, persisted `null` and missing
size are equivalent and do not trigger a rebuild that would discard transient
width, height, or aspect-ratio edits. For models with a discrete `size`
parameter, persisted `null` means the model's declared default size and replaces
any stale concrete size still held in memory.
Missing, stale, or unsupported values use the deployment default count and current
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
uses the deployment default count plus the newly available model's parameter
defaults. Manual selection or settings reuse of a usable model restores
`isImageModelAvailable`. Reselecting the retained provider/model during manual
recovery rebuilds its current parameter defaults while preserving the draft
prompt.

The prompt input rejects empty and whitespace-only values and blocks submission
until configuration initialization has completed and a usable model is
available. Submission trims the prompt, creates a topic when needed, promotes
its optimistic row to the permanent server ID, starts title generation, sends
the request through `imageService`, refreshes the captured topic after every
accepted request, and clears only the prompt that was actually submitted. The
permanent topic becomes active before the service request, so its batch
subscription mounts even when the mobile topic list has never mounted. If that
subscription reads the topic before batch persistence finishes, the
post-acceptance refresh replaces the empty result with the pending generation
rows, so mobile renders queued tiles instead of an apparently blank workspace
while the asynchronous tasks continue. All topic and service failure paths
reset both `isCreating` and the registered request controller; the UI reports
submission failure with a localized message.

Each pending `GenerationItem` polls its asynchronous task while the topic is
active. A successful poll replaces the pending row, refreshes the batch, and
sets the topic's first available thumbnail as its cover. Because the workspace,
not the desktop panel or mobile drawer, owns topic activation, this polling and
cover update continue when mobile Image Topics has never been opened.

The generation feed scrolls only when its end is below the visible boundary
above the sticky prompt. It records an appended batch before task polling can
rerender the feed, so status updates do not repeatedly force the viewport to
the bottom. Smooth scrolling is disabled when the browser requests reduced
motion.

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

The deployment setting `MAX_DEFAULT_IMAGE_NUM` remains 20; it bounds
`AI_IMAGE_DEFAULT_IMAGE_NUM`, not the per-request generation limit.

Chat attachment context has a separate best-effort compatibility step before a
provider call. Each `/webapi/files/...` image reference is independently
resolved to a public object URL. A failed lookup preserves the original proxy
URL so one stale image does not abort context engineering; that preserved URL
may still be unreachable to the provider. This is not the generated-output
ingestion path, which must fetch/decode and transform the provider result before
the task can succeed.

The shared app-file proxy key extractor recognizes absolute references when
their WHATWG `URL.host` equals the configured `APP_URL.host`. Because `host`
contains hostname and port but not scheme, an HTTP/HTTPS scheme difference is
accepted when host and port match. This app-file lookup rule is distinct from
the stricter origin checks used when normalizing new image-generation reference
configuration.

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

Generated image responses can contain multi-megabyte base64 data URIs. The
shared URI parser reads only the fixed header boundaries with string indexing,
then passes the payload to `Buffer.from` before Sharp metadata and thumbnail
processing. It does not run a regular expression across the encoded image,
which keeps parsing stack usage independent of image size. A completed
`provider_call_settled` event with `imageUrlKind=data_uri` followed by a failed
`transform_settled` event identifies a local decode or image-processing failure,
not an upstream generation failure.

OpenAI-compatible image responses are normalized defensively after the provider
returns. Some compatible endpoints report the top-level input, output, and total
token counters but omit `input_tokens_details` or one of its text/image modality
counters. ChatHub preserves every reported total and explicit zero. When
`image_tokens` is present but `text_tokens` is absent, text input is derived as
`max(input_tokens - image_tokens, 0)` to avoid billing the same image tokens as
both text and image input. If image details are also absent, ChatHub omits the
unknown modality split rather than treating all input as text. Pricing uses only
the available or safely derived counters. Incomplete optional usage telemetry
therefore cannot turn a completed image response into a failed task or invent an
unreported token breakdown.

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

Failed-output recreation is replacement-first:

1. Validate the active topic and original generation batch, then select only
   generations whose async task status is `Error`. A batch without failures
   cannot start recreation.
2. Add the batch ID to `regeneratingBatchIds` and register an
   `AbortController`. A second request for the same batch is ignored, while
   other failed batches remain independently actionable.
3. Submit one replacement batch with `imageNum` equal to the failed count and
   reuse the original provider, model, prompt, reference images, and runtime
   configuration. The request includes `sourceGenerationBatchId`; the lambda
   accepts it only when the source batch belongs to the current user and
   generation topic, then reloads the raw stored `imageUrl` and `imageUrls`.
   Client feed URLs are not trusted as retry provenance because feed construction
   expands stored keys into access URLs.

   Reference images stored by ChatHub remain durable object keys in the batch
   config. Every accepted submission writes
   `imageReferenceFormatVersion: 1`, which declares that stored references are
   canonical object keys. Regeneration trusts versioned references exactly as
   stored, so a legitimate `webapi/files/<key>` storage key cannot be rewritten
   based on an unrelated file record. The marker is server-owned: request
   parameters cannot set it, and feed transformation removes it before returning
   the config to clients.

   Unversioned historical references are recovered only when their syntax is
   unambiguous. A root-relative `/webapi/files/<key>` or same-origin absolute
   `${APP_URL}/webapi/files/<key>` reference is decoded to `<key>`. An
   unversioned bare `webapi/files/<key>` value could be either a malformed proxy
   reference or a legitimate storage key, so regeneration fails with
   `PRECONDITION_FAILED` rather than guessing from file ownership or probing
   object storage.

   For new submissions, the lambda unwraps same-origin absolute and
   root-relative app-proxy references to the original object key. Bare
   `webapi/files/<key>` values are canonical storage keys, and a foreign storage
   URL whose pathname also contains `/webapi/files/` continues through the
   backend-specific parser. A same-origin scheme-relative
   `//<APP_HOST>/webapi/files/<key>` reference is also unwrapped against
   `APP_URL`; any other `//<host>/...` reference is rejected with `BAD_REQUEST`
   before storage parsing or database writes because a scheme-relative URL
   requires a base URL and is not a canonical storage key
   ([WHATWG URL syntax](https://url.spec.whatwg.org/#url-syntax)). The origin
   comparison follows the standard `URL.origin` scheme, host, and port identity
   ([MDN URL origin](https://developer.mozilla.org/en-US/docs/Web/API/URL/origin)).
   The lambda then derives fresh model-access URLs from those keys immediately
   before async dispatch, while inline `data:` references pass through unchanged.
   This avoids signing the application proxy path as part of an object key and
   avoids replaying feed URLs whose presigned lifetime has elapsed; AWS documents
   that a presigned URL expires at its configured deadline or when its signing
   credentials expire, whichever happens first
   ([Amazon S3 presigned URL expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)).

4. After the replacement is accepted, remove the entire original batch when
   every output failed. For a mixed batch, remove only the failed generation
   records and retain every successful sibling.
5. Refresh the operation's captured originating topic after submission or
   cleanup settles, even if the user selected another topic while the request
   was in flight. Clear only the current operation's controller and per-batch
   marker.

Submission failure leaves every original record intact and reaches the existing
generation-start error handling. The UI maps the exact server-owned ambiguous
reference error to localized **Reuse Settings** recovery guidance; arbitrary
server or provider error text remains behind the generic generation-start
message. Cleanup or refresh failure after acceptance is wrapped as
`ImageRegenerationCleanupError`: the replacement remains accepted, any undeleted
originals remain available, and the client reports that the topic may need a
refresh instead of presenting the failure as a rejected submission.
An account-scope reset aborts the request, clears the marker with the image
store, and prevents stale refresh or deletion continuations.

`GenerationBatchItem` exposes **Regenerate** only when the batch contains an
`Error` result and places it before **Reuse Settings**. Regenerate starts the
failed-only operation immediately; Reuse Settings remains the edit-before-submit
path. Only the active batch action shows its disabled loading state. The invalid
API-key recovery form invokes the same operation, so its all-failed batch keeps
the whole-batch replacement behavior.

## Source map

- `src/app/[variants]/(main)/image/_layout` — responsive route layouts
- `src/app/[variants]/(main)/image/features` — prompt and generation workspace
- `src/app/[variants]/(main)/image/@menu` — provider/model and parameter controls
- `src/app/[variants]/(main)/image/@topic` — generation-topic navigation
- `src/app/[variants]/(main)/artifacts` — durable generated-image gallery
- `src/store/image` — image state and orchestration
- `src/services/artifacts.ts` — artifact listing client
- `packages/database/src/models/file.ts` — account-scoped artifact query
- `packages/database/src/models/generationTopic.ts` — locked history preview/cleanup
- `src/services/image.ts` — client tRPC service
- `src/server/routers/lambda/file.ts` — artifact listing boundary
- `src/server/routers/lambda/generationTopic.ts` — topic history housekeeping boundary
- `src/server/routers/lambda/image.ts` — persistence and async task dispatch
- `src/server/routers/async/caller.ts` — internal async origin and dispatch headers
- `src/server/routers/lambda/image/schema.ts` — request validation and config guard
- `src/server/routers/lambda/user.ts` (`updateImageConfig`) — DB-backed image preference writes
- `src/services/user/{server,client,type}.ts` — image preference update wiring
- `src/hooks/useFetchAiImageConfig.ts` — scoped preference read and hydration

## Verification

High-signal coverage includes mobile navigation/drawers, always-mounted topic
synchronization, optimistic-to-server topic promotion without a mounted topic
list, plain-text title normalization, store-driven workspace transitions,
pending generation polling, prompt and busy-state failure paths,
replacement-first retry ordering, request-schema boundaries, and the image
generation configuration slices. Artifact workspace tests cover account
ownership bootstrap and server-side search/sort/pagination; router tests cover
UI URL resolution and housekeeping responses. Database model tests require a
configured `DATABASE_TEST_URL` and cover source/account filtering, age cutoffs,
active-task skips, row-lock rechecks, and durable-original preservation.
Legacy ComfyUI transformer tests use test-local model schemas so removed
provider exports are not restored.

## Chat Image tool (provider resolution + generation)

The built-in chat **Image** tool (`lobe-image-designer`) shares the workspace's
configurable model rather than a hard-coded one.

- **Preference resolution** — `resolveImageModel()`
  (`src/store/chat/slices/builtinTool/actions/dalle.ts`) reads the image store's
  `generationConfig` (`provider`/`model`/`parameters`). It only trusts the store
  once `isInit` is true, so it never bills the hard-coded initial default
  (`openai`/`gpt-image-1`); the owner-aware hydration (`useFetchAiImageConfig`) is
  mounted globally in `StoreInitialization` so the config is populated even when
  the user never opened `/image`. If the stored model isn't enabled it falls back
  to the first usable `enabledImageModelList` entry; if none, it surfaces a
  no-model error. Per-generation fields (`prompt`, `imageUrl`, `imageUrls`) are
  stripped so the tool is always text-only.
- **Generation — async task + polling (same pattern as the workspace).**
  Generation can take 30–60 s (e.g. 4K `gpt-image-2`), so the chat tool never
  holds a synchronous request open: `imageGenerationService.createChatImageTask`
  → `POST /webapi/create-chat-image/[provider]` (a thin bridge on its own path
  so the static `/create-image/comfyui` route can never shadow a provider
  segment; it exists so the auth payload carries the IMAGE provider's keyVaults
  via `createHeaderWithAuth(provider)`, and it forwards the RAW encoded auth
  header into the caller context because image procedures run the `keyVaults`
  middleware, which decodes `ctx.authorizationHeader` itself; header-less
  checkAuth bypass modes get the already-authenticated payload re-encoded with
  `obfuscatePayloadWithXOR`, never fabricated for unauthenticated calls) →
  `lambda image.createChatImage` creates a pending `asyncTask` and dispatches
  `async image.createChatImage`, returning the task id immediately. The client
  validates the `{ taskId }` echo before polling, then polls
  `image.getChatImageResult` (2.5 s interval, 300 s budget, notifications
  suppressed). Poll-error classification is status-first regardless of shape:
  guarded (mangled-transport) or plain errors with a 4xx status surface
  immediately; only 5xx and status-less transport failures retry within the
  budget.
- **Task durability — deterministic ids, ownership, verified write-first
  correlation.** Task ids are DETERMINISTIC (sha256-derived, RFC-4122-shaped,
  seeded by user scope + message id + item index + attempt counter; the
  counter is persisted on the item next to the id, and a server-confirmed
  terminal failure advances to the NEXT attempt of the same tuple): any tab
  computes the SAME id for the same attempt, so a cross-tab overlap cannot
  create two different paid tasks — the server's idempotent same-id insert plus the pending-claim
  dedup collapse duplicate submissions into ONE task, and every tab adopts
  the same result. Within a tab, a generation run additionally claims
  exclusive per-item ownership (`inFlightTaskKeys`, a key→run-token map)
  synchronously BEFORE any await, allocation, or write; an overlapping
  same-tab invocation owns nothing and returns. Ownership release is
  guaranteed by a function-level `try/finally` that releases only keys still
  owned by this run's token (so an index a later invocation legitimately
  reclaimed is never stolen) — a stale return or thrown persistence/config
  failure can no longer leak a claim and dead-lock reconcile/Retry until
  reload. Correlation writes are a conflict-aware serialized draft update
  (NOT a persistence-level CAS): a fresh id is written only where the draft
  still has no `taskId`/`imageId`, a concurrently-appeared id is ADOPTED, and
  replacements pin the exact terminally-failed id as their compare value.
  After the awaited write, the ids are checked at their EXACT indices in the
  originating message's persisted content, read from the origin
  conversation's map key (resolved from the tool message in `messagesMap`,
  never from `activeId` / `activeTopicId`). Leave-topic is not Stop: item
  writes pass that originating `conversationContext` so persist still lands
  after a switch. Stop/clear still fail the write. Awaiting the persist call
  alone does not prove the ids landed. Unproven ids → ZERO tasks created,
  per-item error. The result endpoint distinguishes two missing states:
  `task_missing` (no task row — the write-first id was persisted but its
  create never ran, or another tab's create is racing) is NOT terminal and is
  recovered by idempotently re-submitting the SAME id — mount reconciliation
  does this automatically via its adopt probe, so a pre-create persisted id
  never holds its ownership key through a doomed poll budget; `result_missing`
  (the task SUCCEEDED but its correlated file row is gone) is an
  authoritative terminal failure — re-submitting the success id can never be
  re-claimed, so only an explicit Retry advancing to the deterministic
  replacement id can move past it. Because that automatic resubmission is
  BILLABLE, it runs only behind these gates: provenance — a persisted id may
  auto-generate only if it derives exactly from (user scope, message id,
  index, persisted attempt): one derivation, no chain walk and no chain cap,
  so the validator never rejects an id this action legitimately created and
  Retry is not limited to any attempt count. Restored/imported messages (new
  message ids, no task rows in backups) fail the check, surface a per-item
  localized "could not be verified" notice (a stable error type rendered
  through the tool locale, never hard-coded English), and route through
  explicit Retry, which replaces the unproven id with the derived attempt-0
  id and never submits the old one; config readiness — reconcile waits
  (bounded, invalidation-aware) for the owner-scoped image config to finish
  hydrating instead of misreading "still initializing" as "no usable model",
  and the tool render subscribes to that readiness, re-running reconciliation
  when hydration settles — even after the bounded wait expired — so recovery
  needs no remount and no manual Retry; current correlation — the message
  must still exist and still carry that exact unresolved id at that index
  when the create is sent (deleting a message mid-probe aborts silently);
  Stop authorization — auto-create is refused when the tile is marked
  `taskCancelled`, when a same-browser remembered stop id is present (a bounded
  `localStorage` registry written synchronously on Stop **before** any awaited
  durable-cancel or persist, so a hung server-cancel lookup or a rejected first
  message write cannot skip later tiles or leave reload unprotected), when
  `getChatImageResult` returns the cancelled-placeholder error
  (`ChatImageTaskCancelled` — inserted on Stop with `ON CONFLICT DO NOTHING` so
  existing pending/success rows stay adoptable), or when a legacy tile has no
  `taskFence`. Same-session Stop also refuses a prepared fence that no longer
  matches the live (non-zero) lane fence. Reload resets that live fence to 0,
  so that comparison is skipped then — otherwise a later authorized generation
  stamped `taskFence > 0` would be misreported as stopped. Leave-topic does not
  bump the fence. Stop aborts in-flight work before awaiting durable cancel and
  cancellation persist, persists each Image tool message independently (one
  failure does not skip later messages), retries each write once, forgets the
  local stop id after a confirmed `taskCancelled` persist, and logs
  `chat_image_run_settled` with `kind=stop_mark` / `outcome=persist_failed`
  plus the hashed assistant/message id and persisted `gd_…` span. Create
  refuses a `taskCancelled` correlation and does not dispatch when the id
  already has an error placeholder. Explicit Retry re-stamps the fence, clears
  `taskCancelled` and the remembered stop id, and may submit. If every durable
  path fails (offline + storage unavailable + tombstone insert failed), a later
  `task_missing` remount is indistinguishable from crash recovery and may
  auto-create. Existing server tasks (pending or success) are adopted
  before this gate and are never discarded; and
  server-side verification — the create contract REQUIRES the correlation
  (message id + index) and the task id, and the mutation verifies and inserts
  in ONE transaction with the message row read FOR SHARE, linearized against
  message deletion — neither an omitted field nor a delete/create race can
  insert work the conversation no longer contains. Item writes are serialized
  per message (a promise queue in `updateImageItem`). The tool render's
  mount-time `reconcileDallETasks` adopts a finished task's file, resumes
  waiting on a pending one, or surfaces its failure; `retryDallEImages`
  adopts an existing task first and creates a replacement ONLY after the
  server reports an authoritative terminal `error` state with ownership
  re-checked after that await — lookup, transport and local-timeout failures
  surface without creating. Leave-topic keeps the in-tab generate/poll loop
  writing into the originating map; mount-time `reconcileDallETasks` is still
  the backup if that tab died before `imageId` landed. The send `spanId`
  (`gd_…`) is copied onto the unresolved item at persist so a remount create
  can still join `chat_image_task_created` after `deferredBrowserGenerationLanes`
  is gone.
- **Diagnostics.** Chat Image tile create/persist/attach is
  `CHATHUB_GENERATION_DEBUG` (`chat_image_run_started` /
  `chat_image_item_settled` / `chat_image_run_settled` on the send `spanId`,
  plus server `chat_image_task_created` / `chat_image_task_rejected`).
  `CHATHUB_IMAGE_DEBUG` covers the `/image` workspace `async_tasks` path, not
  these tiles. Records carry hashed ids, counts, `visible`, and readable
  `outcome` labels — never prompts or file ids. See
  [Durable conversation generation](durable-conversation-generation.md)
  and `.cursor/rules/debug-log-checks.mdc`.
- **Server-side image handling.** The async procedure runs
  `agentRuntime.createImage` (same runtime init as the workspace; ComfyUI auth
  headers are forwarded to the protected result download exactly like the
  workspace flow), then `GenerationService.transformImageForGeneration` +
  `uploadImageForGeneration`, and creates a **files row** linked to the task
  via `metadata.chatImageTaskId` (`FileModel.findByChatImageTaskId`). The chat
  message stores only the durable `fileId` — the raw provider/base64 payload
  never crosses the task/message boundary into content or the store (that was
  the cause of the live-page crash this design replaced); the browser
  naturally fetches the persisted image file to display it. Provider/task
  failures are categorized onto the task (`categorizeError`) and surface as
  the per-item error card. Results settle independently with bounded
  concurrency. The byte-verifying CORS download path
  (`getImageFileByUrlWithCORS` + `/webapi/proxy` hardening) remains in the
  upload service for other callers but is no longer part of generation.

## Testing

Run the targeted image Vitest suites, the ComfyUI service tests when transformer
fixtures change, and `bun run type-check`. Follow the repository constraints in
[Testing and Change Checklist](../testing.md).
