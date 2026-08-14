import DOMPurify from 'dompurify';

/**
 * Sanitizes arbitrary HTML content to prevent XSS attacks.
 * Uses DOMPurify's default configuration which strips all dangerous elements and attributes.
 * @param content - The HTML content to sanitize
 * @returns Sanitized HTML content safe for rendering with dangerouslySetInnerHTML
 */
export const sanitizeHTML = (content: string): string => {
  return DOMPurify.sanitize(content);
};

/**
 * Namespace applied to every surviving diagram `class`/`id` value. Sanitized
 * SVG renders inline in the app document, so an unprefixed `class="ant-modal-
 * wrap"` (or any framework/hashed class) would opt the node into loaded global
 * CSS and recreate the fixed-overlay / click-interception vector. Prefixing to
 * a token no app or third-party stylesheet defines makes that impossible.
 *
 * The app-side stylesheet (`src/components/SVGDiagram/diagramRules.ts`) builds
 * its selectors from this same constant, so the two cannot drift.
 */
export const DIAGRAM_CLASS_PREFIX = 'svgd-';

// Sanitized SVG is rendered INLINE into the app document (chat bubble +
// artifacts portal), so the policy is a strict allowlist instead of the broad
// DOMPurify SVG profile: anything not needed to draw a diagram is an attack
// surface there. Deliberately excluded:
// - `style` (element AND attribute): un-scoped CSS — a style element applies
//   document-wide and a style attribute allows fixed viewport overlays (UI
//   spoofing / click interception);
// - `script` and event handlers: XSS;
// - `a`, `image`, `use`, `foreignObject`: navigation hijack, remote resource
//   fetches, and content smuggling;
// - gradients: unused by the design system.
// Names AND values are constrained: allowlisting only the attribute name (as an
// earlier revision did for `class`/`id`) still let SVG opt into global app CSS
// via framework class/id gadgets — see the value-level rules further down.
// Entries are lowercase: DOMPurify lowercases names for allowlist matching.
const SVG_ALLOWED_TAGS = [
  // DOMPurify models text nodes as the '#text' pseudo-tag; without it an
  // explicit ALLOWED_TAGS list strips all text content
  '#text',
  'svg',
  'title',
  'desc',
  'defs',
  'g',
  'marker',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
];

const SVG_ALLOWED_ATTR = [
  // document / structure
  'aria-label',
  'class',
  'height',
  'id',
  'preserveaspectratio',
  'role',
  'transform',
  'viewbox',
  'width',
  'xmlns',
  // geometry
  'cx',
  'cy',
  'd',
  'dx',
  'dy',
  'points',
  'r',
  'rx',
  'ry',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
  // paint & stroke
  'fill',
  'fill-opacity',
  'fill-rule',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  // text
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  // markers
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerheight',
  'markerunits',
  'markerwidth',
  'orient',
  'refx',
  'refy',
];

// The diagram class vocabulary the app stylesheet actually styles. Keep in sync
// with `src/components/SVGDiagram/diagramRules.ts` (base classes) and the ramp
// names in `src/components/SVGDiagram/ramps.ts`. Any class token outside this
// set is dropped; surviving tokens are namespaced with DIAGRAM_CLASS_PREFIX.
const DIAGRAM_BASE_CLASSES = new Set(['t', 'ts', 'th', 'box', 'node', 'arr', 'leader']);
const DIAGRAM_RAMP_CLASS = /^c-(amber|blue|coral|gray|green|pink|purple|red|teal)$/;

const isDiagramClass = (token: string): boolean =>
  DIAGRAM_BASE_CLASSES.has(token) || DIAGRAM_RAMP_CLASS.test(token);

// Reduce an arbitrary id/fragment to word characters and hyphen, then
// namespace it. Applied identically to `<marker id>` and to the `url(#…)` in
// `marker-*`, so a reference and its target stay consistent after rewriting.
const namespaceDiagramId = (raw: string): string =>
  DIAGRAM_CLASS_PREFIX + raw.replaceAll(/[^\w-]/g, '').slice(0, 64);

// Paint-capable presentation attributes are parsed as CSS values by the
// browser, so their values are validated against an allowlist grammar. This
// blocks external paint servers (`url(https://…)`) and CSS-escape smuggling
// (`u\72l(…)`). `fill`/`stroke` admit only colors and keywords (gradients are
// gone, so a fragment reference has no legitimate target); `marker-*` admit
// only a same-document fragment reference (the arrowhead marker).
const COLOR_ATTRS = new Set(['fill', 'stroke']);
const MARKER_ATTRS = new Set(['marker-end', 'marker-mid', 'marker-start']);

const SAFE_COLOR_VALUE =
  /^(none|inherit|transparent|currentcolor|context-fill|context-stroke|[a-z]{3,30}|#[\da-f]{3,8}|rgba?\([\d\s%,./]*\)|hsla?\([\d\s%,./a-z]*\))$/i;

const SAFE_MARKER_VALUE = /^url\(#([\w.:-]+)\)$/i;

const enforceDiagramPolicy = (
  node: Node,
  data: { attrName: string; attrValue: string; keepAttr: boolean },
) => {
  const value = data.attrValue.trim();

  if (data.attrName === 'class') {
    const kept = value
      .split(/\s+/)
      .filter(isDiagramClass)
      .map((token) => DIAGRAM_CLASS_PREFIX + token);
    if (kept.length === 0) data.keepAttr = false;
    else data.attrValue = kept.join(' ');
    return;
  }

  if (data.attrName === 'id') {
    // ids exist only to be referenced by markers; keep them solely on <marker>,
    // namespaced so they cannot collide with app element ids or `#id` CSS rules
    if ((node as Element).nodeName?.toLowerCase() !== 'marker') data.keepAttr = false;
    else data.attrValue = namespaceDiagramId(value);
    return;
  }

  if (COLOR_ATTRS.has(data.attrName)) {
    if (!SAFE_COLOR_VALUE.test(value)) data.keepAttr = false;
    return;
  }

  if (MARKER_ATTRS.has(data.attrName)) {
    if (value.toLowerCase() === 'none') return;
    const match = value.match(SAFE_MARKER_VALUE);
    if (!match) data.keepAttr = false;
    else data.attrValue = `url(#${namespaceDiagramId(match[1])})`;
  }
};

/**
 * Sanitizes SVG content down to the diagram vocabulary so it is safe to render
 * inline in the app document.
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  DOMPurify.addHook('uponSanitizeAttribute', enforceDiagramPolicy);
  try {
    return DOMPurify.sanitize(content, {
      ALLOWED_ATTR: SVG_ALLOWED_ATTR,
      ALLOWED_TAGS: SVG_ALLOWED_TAGS,
      KEEP_CONTENT: false,
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute');
  }
};
