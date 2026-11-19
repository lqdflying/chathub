# Chat input editor and OS text-suggestion handling

The chat input (`src/features/ChatInput/InputEditor/`) is a Lexical contenteditable
managed by `@lobehub/editor`. Most editing behavior is stock Lexical plus the
`@lobehub/editor` kernel plugins (`registerRichText`, history, mentions, slash menu).
This page documents the one place where ChatHub deliberately layers on top of Lexical's
input pipeline: `ReplacementTextPlugin.tsx`, which makes OS-level text replacement
(Windows "Microsoft English keyboard" hardware-keyboard text suggestions, macOS/iOS
autocorrect, spellcheck corrections) behave correctly, including in sandboxed/isolated
browsers.

## Input Markdown rendering preference

The editor's live Markdown rendering control lives in **Settings → Common →
Chat Appearance**. It persists through `UserPreference.disableInputMarkdownRender`;
the `inputMarkdownRender` selector deliberately exposes the inverse so the UI
switch reads positively. The retired `/labs` destination redirects to Common
settings, preserving old bookmarks without keeping a separate experimental page.

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

`registerReplacementTextRangeHandler(editor)` registers six capture-phase listeners
(`beforeinput`, `input`, `keydown`, `compositionstart` and `focus` on the editor root,
`pointerdown` on the root's document), one update listener and one high-priority
command handler:

- **`beforeinput` (capture, runs before Lexical's bubble handler)** — classifies
  `insertReplacementText` events into three routes:
  - **Controlled** (the common case): the event carries a payload and either a
    usable same-block target range or an inferable word target, and is not
    mid-composition. The plugin does _selection repair only_ — applies the target
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
    `getTargetRanges` _throws_ are always flagged, because Lexical calls it
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
- **`keydown` (capture)** — records whether the last key was consumed by an IME (key
  `Process`). Any other non-modifier key ends that state and, except for the copy
  shortcut, removes the IME primer (_Thin-client IME_ below).
- **`pointerdown` (capture, on the document)** — ends the IME-key state and removes the
  primer before a click that can read or move the document.
- **`compositionstart` (capture)** — ends the IME-key state: composition events mean
  the IME runs in this browser, not behind a thin client.
- **`focus` (capture) and the update listener** — schedule the primer.
- **`CONTROLLED_TEXT_INSERTION_COMMAND` at `COMMAND_PRIORITY_CRITICAL`** — for
  `insertReplacementText` InputEvent payloads, inserts the `text/plain` payload only,
  stripping trailing newlines and mapping interior newlines to spaces. This bypasses
  `@lexical/rich-text`'s `dataTransfer` path, which prefers `text/html` and can create
  paragraphs (the "see\nsee" symptom); a suggestion must never create a paragraph or
  re-trigger send-on-enter. String payloads and other input types fall through to the
  stock handler.

Payload decoding: the thin client relays IME commits (field capture: Microsoft Pinyin)
as the same synthetic `insertReplacementText` pair, with no `composition*` events, and
fills the `beforeinput` `dataTransfer` with the text's UTF-8 bytes, one byte per UTF-16
unit ("啊" arrives as `"å\u0095\u008A"`). The paired `input` event's `data` is intact,
but the controlled route consumes the `dataTransfer` copy before that event exists. So
`getReplacementText` decodes the `text/plain` payload of **untrusted** events when
every unit is ≤ U+00FF and the units form valid UTF-8 containing a multi-byte sequence;
any other payload ("café") is kept as is, and trusted events are never decoded. The
overlay's `plain=` field shows the raw payload.

Thin-client IME: the thin client runs the IME locally, so the editor gets no
`composition*` events. Each IME key arrives as a trusted `keydown` with key `Process`,
followed by a synthetic `insertReplacementText` pair, and the thin client writes its
text into the DOM between the two events of the pair. While the last key was
`Process`, the plugin routes a synthetic replacement by its target range, never by
word inference:

- **Range over an editor text node** (the running composition; the thin client sends
  the whole node text with range `0..length`): the controlled route above.
- **Collapsed range at the editor's caret** (first letter of a new word): controlled
  insertion at the caret (`controlled (ime caret)`). Word inference here would replace
  the previous word with that letter.
- **Range outside the editor's text nodes** (unmapped: with no text node at the caret,
  as in an empty box, the thin client composes in a local node that has no counterpart
  here): word inference is skipped and the event takes the native-fallback route, so
  Lexical inserts the text from the paired `input` event. This composition cannot be
  saved. Field captures show both outcomes: when the text is inserted, the next keys
  arrive as plain keystrokes (raw `nihao`); when it is held back, the keys stay
  `Process` but the thin client sends no further text at all.

The primer keeps that unmapped case from occurring. The first synthetic replacement
that follows a `Process` key marks the browser profile as a thin-client IME
(`localStorage` `lobe_thin_client_ime`). From then on, 50 ms after focus or any editor
update, a collapsed caret that sits on an element (an empty box, an empty line) gets a
text node holding one zero-width space (`IME_PRIMER`, U+200B, the character Lexical
itself inserts on `compositionstart` in an empty block), with the caret after it
(`ime-prime`). The thin client then maps the composition to that node like any existing
text: this automates the field-proven workaround of typing one character first. The
primer is not placed while the last key was `Process`, without focus, or mid-composition:
a `Process` keydown arrives after the local IME has opened its composition, which is too
late to give that composition a text node, and every IME that runs in the browser itself
reports the same key.

The primer is real text in the model, so the two sides of the thin client stay equal.
It is removed (`ime-strip`) from the start of the caret's text node before any key the
IME does not consume and on a `pointerdown`, which covers Enter and the send button,
and keeps it out of the way of a typed `/` or markdown shortcut. Both edits carry
`HISTORY_MERGE_TAG`, so they add no undo step.

Two events keep the primer. Every committed editor update writes the Lexical selection
into the DOM (`updateDOMSelection`), and removing the primer schedules it again 50 ms
later, so each removal moves the caret into the editor twice. With an empty box that
collapsed a text selection dragged in the messages; a box that holds text has no primer
to remove and never showed it.

- **A `pointerdown` outside the chat input while the box holds only the primer.** The
  layouts mark the chat input with `data-chat-input` on `ChatInput`
  (`Desktop/index.tsx`, `Mobile/index.tsx`). It spans the editor, the format bar, the
  action bar and the send button, whose clicks read or change the document, so a click
  there still removes the primer. Without a marked ancestor every click counts as
  inside. Once text follows the primer, any `pointerdown` removes it, because the send
  menu opens in a portal outside the chat input.
- **The copy shortcut (`Ctrl`/`Cmd`+`C`).** It reads the page selection, which can lie in
  the messages while the box keeps focus.

A box that holds only the primer is
empty for the app: `getMarkdownContent` (`src/features/ChatInput/store/action.ts`)
returns `''` when `$isPrimerOnly` (`InputEditor/imePrimer.ts`) finds only paragraphs and
no text but the primer, and the unload warning in `InputEditor/index.tsx` checks that
value. The check reads the editor model because neither serialization can tell: Markdown
wraps a primer under a bold caret in `**`, and plain text leaves out a horizontal rule,
an empty table and an empty code block. Any block other than a paragraph counts as
content with or without the primer, so an empty list item or quote is not empty, as in
any other browser. The placeholder is hidden while the primer is present, because
`@lobehub/editor` decides that from the untrimmed root text.

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

Field verification note: under DOM-mirroring isolation the _display_ can show
stale/duplicated text that does not exist in the editor state (a thin-client
ghost — the app placeholder may even show through it). The `doc="…"` snapshot
on the overlay's decision lines and the content of a sent message reflect the
true state; if those are correct, the residual artifact is the isolation
product's mirroring bug and cannot be fixed app-side.

## Dependency constraint: exactly one `lexical` instance

The app pins `lexical: 0.38.2` as a direct dependency (the plugin and its tests import
from it) and mirrors that pin in `pnpm.overrides`. `@lobehub/editor` declares a
compatible range, and there is no committed lockfile, so without the override a future
resolution could load two `lexical` module instances — command identities and
`$getSelection`'s module state would then diverge and the plugin would silently no-op.
After dependency changes, `pnpm why lexical` must show a single `lexical@0.38.2`.

## Testing constraints (happy-dom)

`ReplacementTextPlugin.test.ts` runs against Lexical's _real_ event handlers, which
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

## Large plain-text pastes

Huge dumps (logs, JSON, terminal output) must not fill the composer or the
topic bubble. ChatHub collapses them in the UI only; the model still receives
the full text as ordinary `message.content`. This follows Claude Code's chip
model ([paste large content](https://code.claude.com/docs/en/terminal-config#paste-large-content)):
collapse in the prompt, send the original body. It is **not** converted to a
file attachment, because ChatHub file `content` is filled only after document
parse and a send-before-parse can drop the dump.

Threshold (`src/features/ChatInput/pastedText/helpers.ts`): collapse when the
paste has **10+ lines** or **1000+ characters** (either gate). `Ctrl+Shift+V` /
`Cmd+Shift+V` is tracked from `keydown` (`createShiftPasteBypassTracker`); paste
events do not expose `shiftKey` in the DOM or React types. The topic still
collapses after send if the result is huge. Clipboard **files** are ignored so
image paste stays on the existing upload path.

Pending chips are keyed by composer scope in
`src/features/ChatInput/pastedText/store.ts` (`main` vs `thread:<portalThreadId>`),
not `ChatInputProvider`, because mobile topic input is still V1Mobile `TextArea`
and has no provider. The portal thread wraps `DesktopChatInput` in
`PastedTextScopeProvider`. Clear the active scope on successful send, all scopes
on `chatKey` (session + topic) change, the previous thread scope when
`portalThreadId` changes, and everything in `resetAccountScopedStores`. Desktop /
thread intercept uses a Lexical capture-phase `paste` listener plus the shortcut
tracker (`PastedTextPlugin`); V1Mobile uses `TextArea` `onPaste` and keeps chips
in `pastedAddons` so they stay visible while the textarea is focused. V1Mobile
keeps a local draft during `compositionstart`…`compositionend` and only calls
`updateInputMessage` when composition ends (or on blur), so CJK / mobile OS
suggestions do not broadcast every intermediate glyph to the chat store. Desktop
Lexical composers call `updateInputMessage` instead of raw `setState`. All send
paths (`useSend`, group send, V1Mobile, thread) join typed prompt first, then
each paste body from that composer only, with blank lines. Join uses trim only
to skip blank segments; the original prompt and paste bytes are preserved.

The topic card replaces the old 30,000-character `ContentPreview` in
`User/MarkdownRender`. Classification is size-based for any user message over
the threshold (including Shift-inline pastes), not paste-origin metadata. Click
opens the existing message-detail portal. `EditableMessage` still shows full
text when editing. Do not collapse assistant messages.

