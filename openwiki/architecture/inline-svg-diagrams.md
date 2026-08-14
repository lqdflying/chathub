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
- **App side** — `src/components/SVGDiagram/`: `styles.ts` gives those classes
  real values from antd tokens plus the fixed ramp anchors in `ramps.ts`
  (light/mid/dark per ramp; fills and text ink swap with `isDarkMode`, the mid
  stroke works on both). The shared `SVGDiagram` component applies the
  stylesheet in both render sites: `LobeArtifact/Render/InlineSVG.tsx` (bubble;
  streaming skeleton until `isArtifactTagClosed`, card fallback on abort or
  empty sanitize) and `Portal/Artifacts/Body/Renderer/SVG.tsx` (portal).

Renaming/removing a class or ramp on either side breaks the other: prompt
changes need matching stylesheet changes and vice versa.

## Why classes instead of `<style>` or inline colors

The sanitized SVG is injected inline into the app document
(`dangerouslySetInnerHTML`), not an iframe. An SVG `<style>` block would apply
document-wide CSS (UI spoofing risk), so `sanitizeSVGContent`
(`packages/utils/src/client/sanitize.ts`) forbids `style`/`script` and the
profile drops `use`/`foreignObject`; `ADD_ATTR: ['role']` re-allows the a11y
attribute the SVG profile lacks. App-side classes also beat presentation
attributes in CSS precedence, which is what makes theming win over any
hardcoded attributes a disobedient model emits. CSS-in-JS regenerates on
appearance change, so dark mode needs no work in the SVG itself.

## Testing

Sanitizer behavior is covered by `packages/utils/src/client/sanitize.test.ts`,
which must run under jsdom — see the "Vitest DOM environments" section in
`openwiki/testing.md`.
