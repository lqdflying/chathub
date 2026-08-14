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

## Testing

Sanitizer behavior is covered by `packages/utils/src/client/sanitize.test.ts`
(including class/id gadget and paint-value vectors); the export-escaping and
rule-scoping behavior by `src/components/SVGDiagram/diagramRules.test.ts`
(which parses the export as `image/svg+xml`). Both must run under jsdom — see
the "Vitest DOM environments" section in `openwiki/testing.md`.
