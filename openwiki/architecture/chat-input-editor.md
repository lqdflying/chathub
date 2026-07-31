# Chat input editor and OS text-suggestion handling

The chat input (`src/features/ChatInput/InputEditor/`) is a Lexical contenteditable
managed by `@lobehub/editor`. Most editing behavior is stock Lexical plus the
`@lobehub/editor` kernel plugins (`registerRichText`, history, mentions, slash menu).
This page documents the one place where ChatHub deliberately layers on top of Lexical's
input pipeline: `ReplacementTextPlugin.tsx`, which makes OS-level text replacement
(Windows "Microsoft English keyboard" hardware-keyboard text suggestions, macOS/iOS
autocorrect, spellcheck corrections) behave correctly, including in sandboxed/isolated
browsers.

## Why the plugin exists

Accepting an OS text suggestion arrives as a `beforeinput` event with
`inputType: 'insertReplacementText'` (or, in some environments, as a multi-character
`insertText`, a composition commit, or a delete+insert pair). Lexical 0.38 already
handles `insertReplacementText` — it applies the browser's `getTargetRanges()` range,
calls `preventDefault()`, and performs a controlled insertion — but only when its own
selection is collapsed and the range is present and readable. Real environments break
those assumptions in four ways:

1. The Lexical selection can be stale and non-collapsed when the event arrives, so
   Lexical routes the replacement to the wrong text (upstream lexical draft PR #8711
   describes the same failure for dictation).
2. `getTargetRanges()` can be empty, blocked (throws), or return ranges that cross
   block boundaries or point outside the editor (Windows/CKEditor #13583 class).
3. Chromium ≤142 sends `insertReplacementText` in contenteditable with `data === null`
   **and** `dataTransfer === null` — Lexical prevents the event and then inserts
   nothing, silently dropping the suggestion.
4. Sandboxed/isolated browsers can apply the native edit even after `preventDefault()`
   (or deliver a synthetic/untrusted or non-cancelable event), which turns any
   controlled insertion into a duplicate ("fore" + accept "forever" →
   "foreverforever").

Fighting these events with `preventDefault`/`stopImmediatePropagation` plus a manual
insertion is how duplication happens: Lexical's `onInput` handler still runs afterwards
and re-inserts or re-imports the doubled DOM. The plugin therefore never swallows the
event and never inserts on `beforeinput`.

## What the plugin does

`registerReplacementTextRangeHandler(editor)` registers two capture-phase listeners on
the editor root plus one high-priority command handler:

- **`beforeinput` (capture, runs before Lexical's bubble handler)** — classifies
  `insertReplacementText` events into three routes:
  - **Controlled** (the common case): the event carries a payload and either a
    usable same-block target range or an inferable word target, and is not
    mid-composition. The plugin does *selection repair only* — applies the target
    range when the Lexical selection is stale/non-collapsed, or selects the typed
    word when no usable range exists — then lets Lexical's own handler perform the
    `preventDefault` + controlled insertion. **Synthetic events (`isTrusted ===
    false`) take this route too**: field capture from a remote-browser-isolation
    thin client (Menlo Safeview class) showed acceptance arrives as an untrusted,
    non-cancelable `insertReplacementText` with a `text/plain` payload and a bogus
    collapsed target range. Synthetic events have **no native default action** —
    the injector expects the editor to perform the replacement, so handing them
    "back to the browser" silently drops the suggestion. For synthetic events the
    word inference also accepts whole-word corrections ("teh" → "the"), since
    there is no native edit to fall back on.
  - **Native fallback** (flagged with Lexical's `_lexicalHandled` skip property so
    Lexical ignores the event): mid-composition events, **trusted** non-cancelable
    events (a real IME/autocorrect acceptance the browser applies itself),
    payload-less events (Chromium ≤142), and events with neither a usable range
    nor an inferable word. The browser applies the edit once and Lexical's
    `onInput` reconciliation (`$updateSelectedTextFromDOM` + `$flushMutations`)
    syncs the DOM into the model (the ProseMirror posture). Events whose
    `getTargetRanges` *throws* are always flagged, because Lexical calls it
    without a try/catch and would crash mid-handler.
  - Multi-character `insertText` events get the same selection repair (never
    flagging), keeping Lexical's normal typing bookkeeping intact.
- **`input` (capture)** — pairs each controlled `beforeinput` with its follow-up
  `input` event and stops Lexical's `onInput` from double-processing it. Two
  pairings exist: a **synthetic pair** (untrusted armed event + untrusted input —
  injectors always dispatch one, and their events can never be default-prevented),
  and a **trusted prevented pair** (in compliant browsers a prevented edit fires no
  `input` at all, so its arrival means the environment ignored `preventDefault`).
  In both cases the `input` event is flagged; if the DOM text of the selection
  anchor additionally diverges from the model, the DOM is rewritten from the model
  by marking the text node dirty in a discrete update. A third field-observed shape
  is handled here too: the same injector can deliver the acceptance with a
  **completely payload-less `beforeinput`** and the text riding only the paired
  `input` event's `data`. The payload-less synthetic `beforeinput` arms a one-shot
  state; the paired synthetic `input` is then flagged away from Lexical and the
  replacement is applied directly (whole-word selection + plain-text insert), with
  an ends-with dedupe so repeated deliveries of the same acceptance stay
  idempotent. Fully empty echo pairs (no payload anywhere) change nothing.
- **`CONTROLLED_TEXT_INSERTION_COMMAND` at `COMMAND_PRIORITY_CRITICAL`** — for
  `insertReplacementText` InputEvent payloads, inserts the `text/plain` payload only,
  stripping trailing newlines and mapping interior newlines to spaces. This bypasses
  `@lexical/rich-text`'s `dataTransfer` path, which prefers `text/html` and can create
  paragraphs (the "see\nsee" symptom); a suggestion must never create a paragraph or
  re-trigger send-on-enter. String payloads and other input types fall through to the
  stock handler.

A diagnostic probe logs every `beforeinput`/`input`/`textInput`/`keydown`/
`composition*` event (`inputType`, `data`, `dataTransfer` types and text/plain,
`cancelable`, `isTrusted`, `isComposing`, target ranges) plus the plugin's routing
decision (trusted / native-fallback with reasons / guard repair). Enable it with
`localStorage.setItem('lobe_replacement_debug', '1')` — or, critically, by visiting
the app with `?replacement_debug=1` (or `#replacement_debug=1`) appended to the URL,
which persists the flag; `replacement_debug=0` clears it. Output goes to
`console.debug` **and** to a fixed-position on-page overlay
(`#replacement-debug-overlay`). The URL/overlay pair exists because remote-browser-
isolation products (e.g. Menlo "Safeview" thin clients) run the app in a remote
browser: local DevTools and local `localStorage` never reach the app, and the app's
console output never reaches the user — but the URL travels inbound and the mirrored
DOM travels outbound, so the overlay is visible through the isolation layer.

## Dependency constraint: exactly one `lexical` instance

The app pins `lexical: 0.38.2` as a direct dependency (the plugin and its tests import
from it) and mirrors that pin in `pnpm.overrides`. `@lobehub/editor` declares a
compatible range, and there is no committed lockfile, so without the override a future
resolution could load two `lexical` module instances — command identities and
`$getSelection`'s module state would then diverge and the plugin would silently no-op.
After dependency changes, `pnpm why lexical` must show a single `lexical@0.38.2`.

## Testing constraints (happy-dom)

`ReplacementTextPlugin.test.ts` runs against Lexical's *real* event handlers, which
requires working around happy-dom divergences from browsers:

- happy-dom's `InputEvent` lacks `getTargetRanges`, and Lexical computes
  `CAN_USE_BEFORE_INPUT` once at module evaluation. The test shims
  `InputEvent.prototype.getTargetRanges` inside `vi.hoisted` (before the `lexical`
  import) — without it, Lexical never attaches its `beforeinput` handler and the suite
  validates a stand-in instead of reality.
- happy-dom defaults `InputEvent.data` to `''` (browsers use `null` for
  `insertReplacementText`) and constructs events with `isTrusted: false`; the event
  factory defines both explicitly.
- Lexical defers non-discrete commits (event handlers, command dispatches) to a
  microtask. Browsers run a microtask checkpoint between events; tests must `await` a
  flush between dispatching an event and asserting state or dispatching a follow-up.
- happy-dom fires `selectionchange` synchronously from `Selection` mutations (browsers
  queue it as a task), which re-enters Lexical's selection handler mid-helper; the
  test helpers mute the synchronous dispatch while writing the DOM selection.
- happy-dom never applies native default actions, so the "browser applied the edit"
  scenarios simulate it by writing `Text.nodeValue` and the DOM selection directly
  before dispatching the `input` event.

Run the suite with:

```bash
bunx vitest run --silent='passed-only' 'src/features/ChatInput/InputEditor/ReplacementTextPlugin.test.ts'
```
