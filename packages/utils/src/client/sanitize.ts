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

// Sanitized SVG is rendered INLINE into the app document (chat bubble +
// artifacts portal), so the policy is a strict allowlist instead of the broad
// DOMPurify SVG profile: anything not needed to draw a diagram is an attack
// surface there. Deliberately excluded:
// - `style` (element AND attribute): un-scoped CSS — a style element applies
//   document-wide and a style attribute allows fixed viewport overlays (UI
//   spoofing / click interception);
// - `script` and event handlers: XSS;
// - `a`, `image`, `use`, `foreignObject`: navigation hijack, remote resource
//   fetches, and content smuggling.
// The diagram design system (src/tools/artifacts/systemRole.ts,
// <svg_diagram_instructions>) needs none of these — themed styling comes from
// app-side classes instead.
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
  'lineargradient',
  'radialgradient',
  'stop',
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
  // gradients
  'gradienttransform',
  'gradientunits',
  'offset',
  'spreadmethod',
  'stop-color',
  'stop-opacity',
];

// Paint-capable presentation attributes are parsed as CSS values by the
// browser, so their values are validated against an allowlist grammar: plain
// colors, keywords, or a same-document fragment reference. This blocks
// external paint servers (`url(https://…)`) and CSS-escape smuggling
// (`u\72l(…)`) — anything not matching is dropped with its attribute.
const CSS_URL_CAPABLE_ATTRS = new Set([
  'fill',
  'marker-end',
  'marker-mid',
  'marker-start',
  'stroke',
]);

const SAFE_PAINT_VALUE =
  /^(none|inherit|transparent|currentcolor|context-fill|context-stroke|[a-z]{3,30}|#[\da-f]{3,8}|rgba?\([\d\s%,./]*\)|hsla?\([\d\s%,./a-z]*\)|url\(#[\w.:-]+\))$/i;

const enforceSafePaintValues = (
  _node: Node,
  data: { attrName: string; attrValue: string; keepAttr: boolean },
) => {
  if (!CSS_URL_CAPABLE_ATTRS.has(data.attrName)) return;
  if (!SAFE_PAINT_VALUE.test(data.attrValue.trim())) data.keepAttr = false;
};

/**
 * Sanitizes SVG content down to the diagram vocabulary so it is safe to render
 * inline in the app document.
 * @param content - The SVG content to sanitize
 * @returns Sanitized SVG content safe for rendering
 */
export const sanitizeSVGContent = (content: string): string => {
  DOMPurify.addHook('uponSanitizeAttribute', enforceSafePaintValues);
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
