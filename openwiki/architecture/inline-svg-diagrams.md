# Inline SVG Diagrams

`image/svg+xml` artifacts render inline in the chat bubble (all other artifact
types keep the card + portal behavior). The feature is a two-sided contract —
a prompt vocabulary and an app stylesheet that must stay in sync.

## The contract

- **Prompt side** — `src/tools/artifacts/systemRole.ts`, section
  `<svg_diagram_instructions>`: instructs the model to draw with a fixed
  `viewBox="0 0 680 H"`, class-based styling only (`th`/`ts` text, `box`,
  `arr`, `leader`, and the `c-<ramp>` color groups), the arrow-marker defs
  boilerplate (`fill="context-stroke"`), per-character width math so labels
  fit their boxes, and required `role="img"` + `<title>` + `<desc>`.
- **App side** — `src/components/SVGDiagram/`: `diagramRules.ts` is the single
  source of the visual rules, built from antd tokens plus the fixed ramp
  anchors in `ramps.ts` (light/mid/dark per ramp; fills and text ink swap with
  `isDarkMode`, the mid stroke works on both). `styles.ts` wraps those rules in
  the app stylesheet (plus layout-only styling), and the SVG download in
  `Actions.tsx` embeds the same rules as a `<style>` element via
  `buildStandaloneSVG` so the exported file matches the preview. The shared
  `SVGDiagram` component applies the stylesheet in both render sites:
  `LobeArtifact/Render/InlineSVG.tsx` (bubble; streaming skeleton until
  `isArtifactTagClosed`, card fallback on abort or empty sanitize) and
  `Portal/Artifacts/Body/Renderer/SVG.tsx` (portal).

The class vocabulary is **namespaced**: the model emits the short names
(`box`, `c-blue`, …) but the sanitizer rewrites every surviving token to a
`svgd-` prefix (`DIAGRAM_CLASS_PREFIX`, exported from `sanitize.ts` and consumed
by `diagramRules.ts`/`styles.ts` so the selectors match). This is a security
boundary, not cosmetics — see below.

Typography and ink rules are scoped to the explicit prompt classes
(`text.t/.ts/.th`, `.c-*` descendants) — never bare `text` — so legacy SVGs
styled through presentation attributes render as authored instead of being
overridden. `diagramRules.test.ts` guards this scoping.

Renaming/removing a class or ramp on either side breaks the other: prompt
changes need matching stylesheet changes and vice versa.

## Why classes instead of `<style>` or inline colors

The sanitized SVG is injected inline into the app document
(`dangerouslySetInnerHTML`), not an iframe, so `sanitizeSVGContent`
(`packages/utils/src/client/sanitize.ts`) enforces a strict allowlist rather
than DOMPurify's broad SVG profile: only diagram elements (shapes, text,
markers, `#text`) and presentation attributes survive. Excluded by design:
`style` elements AND attributes (document-wide CSS / fixed-overlay UI
redress), `script` and handlers (XSS), `a`/`image`/`use`/`foreignObject`
(navigation hijack, remote fetches), and gradients (unused by the design
system). CSS-in-JS regenerates on appearance change, so dark mode needs no
work in the SVG itself.

The boundary is enforced at the **value** level, not just the attribute name —
name-only allowlisting still lets SVG opt into loaded global CSS:

- `class`: each token must be in the diagram vocabulary; unknown tokens
  (framework classes like `ant-modal-wrap`, hashed `css-*`) are dropped, and
  survivors are `svgd-`-namespaced so they can never match app/third-party
  rules. Without this, `class="ant-modal-wrap"` inherits antd's fixed,
  full-inset modal CSS and recreates the redress vector.
- `id`: kept only on `<marker>` (nothing else needs one once gradients are
  gone) and namespaced, so it cannot collide with app element ids or `#id`
  rules. `marker-*` references are rewritten with the same namespace so the
  arrowhead still resolves.
- `fill`/`stroke`: colors and keywords only (no `url()` — no gradient target
  exists); `marker-*`: only same-document `url(#id)`. External paint servers
  and CSS-escape smuggling are dropped.

The **standalone export** (`buildStandaloneSVG`) serializes the _whole_ finished
document as XML, not just the injected stylesheet. `sanitizeSVGContent` returns
HTML serialization, which can carry named entities XML does not define — e.g.
ordinary diagram text with a non-breaking space comes back as `&nbsp;`, which
makes an `image/svg+xml` download fail to parse. So the sanitized body is parsed
as HTML (decoding those entities), the stylesheet is added as a `<style>` node
via `textContent`, and the SVG root is re-serialized with `XMLSerializer`. That
serialization also escapes any `&`/`<`/`>` in the rules — notably the
operator-set `CUSTOM_FONT_FAMILY` flowing through `token.fontFamily` — so no
manual escaping is needed and injected markup stays inert text. The helper is
browser/jsdom-only (its sole caller is the download handler).

## Visual code blocks (non-artifact models)

The inline SVG **artifact** path above only fires for `<lobeArtifact
type="image/svg+xml">`. Non-Claude models (e.g. kimi-k3) instead return diagrams
as fenced **code blocks** (often mislabeled — an SVG tagged "plaintext"), which
would otherwise show as raw source. `renderCodeBlockBody`
(`src/features/Conversation/components/CodeBlockActions/index.tsx`) routes such
blocks to `VisualCodeBlock`:

- **Detection is content-based** (`visualCode.ts`): `isSvgCode` (starts with
  `<svg` or `svg` language), `isHtmlCode` (full document — `<!doctype html>`/
  `<html>` — or `html` language).
- **Render is a sandboxed iframe** for BOTH html and svg —
  `sandbox="allow-scripts"` and **never `allow-same-origin`** (opaque origin: no
  app cookie/storage/DOM access), `srcDoc`, `referrerPolicy="no-referrer"`. SVG
  is wrapped in a minimal responsive HTML document so it scales. Unlike the
  artifact path (strict `sanitizeSVGContent`, no gradients, themed), code blocks
  are arbitrary art → full fidelity via isolation instead of sanitization.
- **Streaming / completion** (`isVisualComplete`): defaults to source until the
  block is renderable, then auto-flips to rendered (a manual toggle sticks). SVG
  needs `</svg>`; a **full HTML document** needs `</html>`/`</body>`; an
  **html-language fragment** has no closing-document marker, so it counts as
  complete and renders once received (a partial full document stays source).
- **Toolbar**: the word-wrap action is omitted for visual blocks — in render
  mode a visual block mounts no `<pre>`, so its ancestor-walk would restyle an
  unrelated code block. Downloads use the effective detected type (a mislabeled
  SVG saves as `.svg`, a full HTML doc as `.html`), not the source language.
- Full-screen preview (the eye-icon drawer) is HTML-only; SVG code blocks have
  the inline Preview/Code toggle and fill the block.
- Mermaid is untouched (rendered by `@lobehub/ui`, never reaches `bodyRender`).

## Mobile navigation & interrupted replies

- The code-block HTML preview drawer (`HtmlPreview/PreviewDrawer.tsx`) uses
  `100dvh` (not `100vh`, which pushed the close X off-screen on mobile) and its
  open state is `useWorkspaceModal` so a phone Back closes it; its iframe also
  drops `allow-same-origin`.
- HTML **artifacts** open the workspace once per generation and never on mobile
  (`LobeArtifact/Render/index.tsx`) — the old effect re-opened on every stream
  tick; the mobile portal Modal (`@portal/_layout/Mobile.tsx`) is tied to the
  route so Back closes it.
- An interrupted reply persists as `LOADING_FLAT` ('...') because content saves
  only at `onFinish`; `Messages/Default.tsx` gates the loading dots on
  `isMessageGenerating` + a `createdAt`-staleness check so a reloaded orphan
  renders nothing instead of looping on dots.

## Background generation across topic switches

A topic switch no longer cancels the in-flight reply — it finishes streaming in
the background and persists to its original topic. The write path was already
topic-safe: every stream handler and `onFinish` targets the captured
`conversationContext = {generation, sessionId, topicId}` (`store/chat/types.ts`),
and the DB update keys off `messages.id`, never the active topic. Two changes
enable it:

- **`isCurrentConversation()`** (`generateAIChat.ts` ×2, `generateAIChatV2.ts`
  ×2) drops the `activeTopicId` clause — validity is pinned to account +
  `conversationClearGeneration` + `sessionId`, so a backgrounded run's handlers
  keep firing and persisting after a switch. (The retry gate, which writes by
  captured `activeTopicId`, is intentionally unchanged.)
- **`switchTopic`** (`topic/action.ts`) skips `internal_invalidateConversation`
  **only while a generation is running** (`chatLoadingIds.length > 0`); idle
  switches keep their existing cleanup, so no stale generation counter lingers.

Scope: single background run. The one global `chatLoadingIdsAbortController` means
a backgrounded reply can't be manually Stopped, and an explicit invalidate (agent
switch via `internal_updateActiveId`, clear-history) or Stop still cancels it.
Full concurrent per-topic generation (per-`messageMapKey` controllers + Stop)
would be a larger refactor.

## Testing

Sanitizer behavior is covered by `packages/utils/src/client/sanitize.test.ts`
(including class/id gadget and paint-value vectors); the export-escaping and
rule-scoping behavior by `src/components/SVGDiagram/diagramRules.test.ts`
(which parses the export as `image/svg+xml`). Both must run under jsdom — see
the "Vitest DOM environments" section in `openwiki/testing.md`. The code-block
detectors and the `allow-scripts`-only iframe are covered by
`src/features/Conversation/components/CodeBlockActions/{visualCode,index}.test.*`.
