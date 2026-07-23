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

The prompt input rejects empty and whitespace-only values before entering a
busy state. Submission trims the prompt, creates a topic when needed, sends the
request through `imageService`, refreshes an existing topic, and clears only the
prompt that was actually submitted. All topic and service failure paths reset
both `isCreating` and `isCreatingWithNewTopic`; the UI reports submission
failure with a localized message.

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

The user setting `MAX_DEFAULT_IMAGE_NUM` remains 20; it is a settings boundary,
not the per-request generation limit.

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
- `src/server/routers/lambda/image/schema.ts` — request validation and config guard

## Verification

High-signal coverage includes mobile navigation/drawers, prompt and busy-state
failure paths, replacement-first retry ordering, request-schema boundaries, and
the image generation configuration slices. Legacy ComfyUI transformer tests use
test-local model schemas so removed provider exports are not restored.

Run the targeted image Vitest suites, the ComfyUI service tests when transformer
fixtures change, and `bun run type-check`. Follow the repository constraints in
[Testing and Change Checklist](../testing.md).
