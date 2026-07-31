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
  `insertReplacementText` events. Trustworthy events (trusted, cancelable, not
  composing, with a payload and either a usable same-block target range or an
  inferable typed-word prefix) get *selection repair only*: the target range is
  applied when the Lexical selection is stale/non-collapsed, or the typed prefix is
  selected when no usable range exists. Lexical's own handler then performs the
  `preventDefault` + controlled insertion. Untrustworthy events are flagged with
  Lexical's internal `_lexicalHandled` property so Lexical skips them entirely; the
  browser applies the edit once and Lexical's `onInput` reconciliation
  (`$updateSelectedTextFromDOM` + `$flushMutations`) syncs the DOM into the model
  (the ProseMirror posture). Events whose `getTargetRanges` *throws* are always
  flagged, because Lexical calls it without a try/catch and would crash mid-handler.
  Multi-character `insertText` events get the same selection repair (never flagging),
  keeping Lexical's normal typing bookkeeping intact.
- **`input` (capture)** — a residual guard for environments that ignore
  `preventDefault`: if the immediately-preceding trusted replacement was
  default-prevented yet an `input` event still arrives and the DOM text of the
  selection anchor diverges from the model, the plugin flags the `input` event (so
  Lexical does not import the doubled DOM) and rewrites the DOM from the model by
  marking the text node dirty in a discrete update. In compliant browsers a prevented
  edit produces no `input` event, so this is a no-op.
- **`CONTROLLED_TEXT_INSERTION_COMMAND` at `COMMAND_PRIORITY_CRITICAL`** — for
  `insertReplacementText` InputEvent payloads, inserts the `text/plain` payload only,
  stripping trailing newlines and mapping interior newlines to spaces. This bypasses
  `@lexical/rich-text`'s `dataTransfer` path, which prefers `text/html` and can create
  paragraphs (the "see\nsee" symptom); a suggestion must never create a paragraph or
  re-trigger send-on-enter. String payloads and other input types fall through to the
  stock handler.

A diagnostic probe (enabled with `localStorage.setItem('lobe_replacement_debug', '1')`)
logs every `beforeinput`/`input`/`composition*` event's `inputType`, `cancelable`,
`isTrusted`, `isComposing`, `dataTransfer` types, and target ranges to `console.debug`,
for classifying misbehaving environments that cannot be reproduced locally.

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
