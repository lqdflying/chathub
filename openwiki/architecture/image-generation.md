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
wait for hydrated global status, user settings, and enabled provider models
before generation is available. This avoids mobile submitting the store's
initial hardcoded values while Image Settings remains in its closed drawer.
`isInit` records that hydration has settled, while `isImageModelAvailable`
records whether the current configuration can generate. If no usable image
model is enabled, initialization settles with `isInit: true` and
`isImageModelAvailable: false`; Image Settings shows its provider/model guidance
instead of a loading skeleton, submission remains unavailable, and `imageNum`
is set to the user's current default rather than retaining the store's
hardcoded initial value.

For signed-in users, the browser-local `LOBE_SYSTEM_STATUS` record remembers
the selected provider/model, image count, and a model-supported `size` value.
Only these preference fields are restored; prompts, seeds, reference images,
width/height, aspect-ratio edits, and other runtime parameters remain
transient. Restore validates the count against the request range of 1 through
50 and validates size against the active model schema. Missing, stale, or
unsupported values use the user's default count and current model defaults. A
removed, disabled, or unusable remembered model falls back to the first usable
enabled image model while retaining a valid remembered image count. Usability
requires the model's parameter schema to produce a valid generation
configuration; schema-less entries remain in provider infrastructure state but
are skipped by image configuration resolution. The model selector uses this
same usability check, omits invalid entries, and shows the provider settings
guidance when no child can produce a configuration. It also rechecks usability
before dispatching selection to protect against provider-list changes between
render and interaction. A draft prompt typed
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

## Verification

High-signal coverage includes mobile navigation/drawers, prompt and busy-state
failure paths, replacement-first retry ordering, request-schema boundaries, and
the image generation configuration slices. Legacy ComfyUI transformer tests use
test-local model schemas so removed provider exports are not restored.

Run the targeted image Vitest suites, the ComfyUI service tests when transformer
fixtures change, and `bun run type-check`. Follow the repository constraints in
[Testing and Change Checklist](../testing.md).
