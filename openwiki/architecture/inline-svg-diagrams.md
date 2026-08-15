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
- **Storage shim for the opaque origin** (`injectSandboxShim`, `visualCode.ts`):
  the HTML-doc `srcDoc` gets one inert `<script>` injected after the first
  **active-markup** `<head>` (else `<html>`, else `<!doctype>`, else prepended) —
  anchors that appear only inside an HTML comment (`<!-- <head> -->`) are skipped,
  so a pre-head comment can't swallow the shim and leave it inert. It replaces
  `localStorage`/`sessionStorage` with no-op stubs **only if accessing them
  throws**. Without it, LLM HTML that embeds mermaid.js from a CDN (or anything
  touching storage) hits `SecurityError` in the `allow-scripts`-only origin, never
  paints, and leaves its own CSS loading spinner (a big ring) stuck — recurring on
  every history remount. The shim grants no capability and does **not** relax the
  sandbox (still no `allow-same-origin`); the SVG wrapper is our own inert document
  and skips it.
- **What inlines** (`isVisualCode`): SVG and **full HTML documents only**. A bare
  html fragment (`<div>…</div>`) is NOT inlined — it has no closing-document
  marker, so it can't be stream-gated and would otherwise mount/run its scripts
  repeatedly mid-stream; it stays a normal source block (with the on-demand
  eye-icon preview via `isHtmlCode`).
- **Streaming / completion** (`isVisualComplete`): defaults to source until the
  block is renderable, then auto-flips to rendered (a manual toggle sticks). SVG
  needs `</svg>`; a full HTML document needs `</html>`/`</body>` — a partial
  document stays source.
- **Toolbar**: the word-wrap action is omitted for visual blocks — in render
  mode a visual block mounts no `<pre>`, so its ancestor-walk would restyle an
  unrelated code block. Downloads use the effective detected type (a mislabeled
  SVG saves as `.svg`, a full HTML doc as `.html`), not the source language.
- Full-screen preview (the eye-icon drawer) is HTML-only; SVG code blocks have
  the inline Preview/Code toggle and fill the block.
- Mermaid fences take a different path — `@lobehub/ui`'s native `Mermaid`, not
  `VisualCodeBlock` — but their click-to-zoom is now wrapped; see _Mermaid zoom
  drawer_ under Mobile navigation below.

## Mobile navigation & interrupted replies

- The code-block HTML preview drawer (`HtmlPreview/PreviewDrawer.tsx`) is a
  bottom `Drawer` at `calc(100dvh - env(safe-area-inset-top))` on mobile — plain
  `100dvh`/`100vh` renders the header (close X) behind the status bar under
  `viewport-fit=cover`. The inset keeps the ✕ reachable as the primary close.
  Open state is driven solely by `useWorkspaceModal`, which force-closes the
  drawer on mobile when `showMobileWorkspace` (a nuqs query param) goes false —
  the phone Back pops exactly the entry that set that param, so Back dismisses the
  drawer and navigates to the **previous history destination** (the chat list
  when the workspace was opened from there; whatever preceded it otherwise — this
  is route-driven navigation-away, not a close-in-place). (An earlier build pushed a
  custom same-URL history entry so Back closed _only_ the drawer; it was removed
  because `history.back()` is async — a rapid ✕-then-reopen let the stale
  traversal's `popstate` reach the newly opened drawer's listener and close it.
  The route-driven close has no such race.) The iframe drops `allow-same-origin`.
- **Mermaid zoom drawer** reuses that exact model. `@lobehub/ui`'s `Mermaid`
  accepts a `bodyRender` (flows through `componentProps.mermaid` in
  `Assistant/index.tsx`), so the diagram is wrapped by
  `Conversation/components/MermaidZoom`: `enablePanZoom: false` disables antd's
  `Image` preview lightbox — whose ✕ is fixed at `top:32px` under the notch, whose
  ESC is desktop-only, and which rc-image never ties to history (the exact mobile
  trap the HTML drawer avoids) — and tapping the diagram opens `MermaidDrawer`, the
  same bottom `Drawer` + `useWorkspaceModal` route-close as the HTML preview, with
  zoom-in/out/reset controls. Applies on **both** mobile and desktop; the drawer
  re-renders the diagram at full size via the exported `SyntaxMermaid`.
- **Loading resets must include `messageRAGLoadingIds`.** The avatar spinner is
  `loading = isInRAGFlow || generating` (`Assistant/index.tsx`), i.e.
  `messageRAGLoadingIds || chatLoadingIds`. `internal_invalidateConversation`
  (`message/action.ts`) clears BOTH; it previously omitted the RAG array, so an id
  orphaned mid-retrieval left the ring spinning forever across topic switches.
  `rag.ts`'s `finally` toggle-off keeps its `isCurrentRequest()` guard (so a stale
  request can't clear a newer request that reused the id) — the orphan case that
  guard used to cause is now covered by the invalidate reset above.
- HTML **artifacts** open the workspace once per generation and never on mobile
  (`LobeArtifact/Render/index.tsx`) — the old effect re-opened on every stream
  tick; the mobile portal Modal (`@portal/_layout/Mobile.tsx`) is tied to the
  route so Back closes it.
- An interrupted reply persists as `LOADING_FLAT` ('...') because content saves
  only at `onFinish`; `Messages/Default.tsx` gates the loading dots on
  `isMessageGenerating` + a `createdAt`-staleness check so a reloaded orphan
  renders nothing instead of looping on dots. (A topic switch still cancels the
  in-flight reply — a "keep generating in the background" attempt was reverted
  because the minimal `chatLoadingIds`-based approach broke tool-call
  continuation, translation cleanup, and concurrent sends; correct support needs
  an explicit per-conversation operation lifecycle.)

## Testing

Sanitizer behavior is covered by `packages/utils/src/client/sanitize.test.ts`
(including class/id gadget and paint-value vectors); the export-escaping and
rule-scoping behavior by `src/components/SVGDiagram/diagramRules.test.ts`
(which parses the export as `image/svg+xml`). Both must run under jsdom — see
the "Vitest DOM environments" section in `openwiki/testing.md`. The code-block
detectors and the `allow-scripts`-only iframe are covered by
`src/features/Conversation/components/CodeBlockActions/{visualCode,index}.test.*`.
