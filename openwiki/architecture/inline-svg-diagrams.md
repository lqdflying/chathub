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
gradients, markers, `#text`) and presentation attributes survive. Excluded by
design: `style` elements AND attributes (document-wide CSS / fixed-overlay UI
redress), `script` and handlers (XSS), `a`/`image`/`use`/`foreignObject`
(navigation hijack, remote fetches). Paint-capable attributes (`fill`,
`stroke`, `marker-*`) additionally pass a value grammar that only admits
colors, keywords, or same-document `url(#id)` references — external paint
servers and CSS-escape smuggling are dropped. CSS-in-JS regenerates on
appearance change, so dark mode needs no work in the SVG itself.

## Testing

Sanitizer behavior is covered by `packages/utils/src/client/sanitize.test.ts`,
which must run under jsdom — see the "Vitest DOM environments" section in
`openwiki/testing.md`.
