/**
 * @vitest-environment jsdom
 */
import { sanitizeSVGContent } from '@lobechat/utils/client';
import { describe, expect, it } from 'vitest';

import { type DiagramRuleTokens, buildDiagramRules, buildStandaloneSVG } from './diagramRules';

const tokens: DiagramRuleTokens = {
  colorBorder: '#d0d0d0',
  colorBorderSecondary: '#e0e0e0',
  colorFillQuaternary: '#f5f5f5',
  colorText: '#111111',
  colorTextSecondary: '#555555',
  colorTextTertiary: '#888888',
  fontFamily: 'TestSans, sans-serif',
};

const parseSvg = (xml: string): Document => new DOMParser().parseFromString(xml, 'image/svg+xml');

// U+00A0 (non-breaking space) written explicitly so it survives editors/prettier
const NBSP = '\u00A0';

const MINIMAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect class="svgd-box" x="1" y="1" width="8" height="8"/></svg>';

describe('buildDiagramRules', () => {
  it('scopes typography and ink to the explicit text classes only', () => {
    const rules = buildDiagramRules(tokens, false);

    expect(rules).toContain('text.svgd-t');
    expect(rules).toContain('text.svgd-ts');
    expect(rules).toContain('text.svgd-th');
    // a bare `text` selector (unqualified by a class like `text.svgd-t` or a
    // `.svgd-c-*` ancestor) would override authored presentation attributes in
    // legacy SVGs — it must never exist
    expect(rules).not.toMatch(/(?:^|[,}])\s*text\s*[,{]/);
  });

  it('styles the shape and connector classes', () => {
    const rules = buildDiagramRules(tokens, false);

    expect(rules).toMatch(/\.svgd-box\s*\{[^}]*fill: #f5f5f5/);
    expect(rules).toMatch(/\.svgd-arr\s*\{[^}]*stroke: #888888/);
    expect(rules).toMatch(/\.svgd-leader\s*\{[^}]*stroke-dasharray: 4 3/);
  });

  it('flips ramp fills between light and dark mode', () => {
    const light = buildDiagramRules(tokens, false);
    const dark = buildDiagramRules(tokens, true);

    expect(light).toMatch(/\.svgd-c-blue rect[^{]*\{[^}]*fill: #E6F1FB/);
    expect(dark).toMatch(/\.svgd-c-blue rect[^{]*\{[^}]*fill: #042C53/);
    expect(light).toMatch(/\.svgd-c-blue text\s*\{[^}]*fill: #042C53/);
    expect(dark).toMatch(/\.svgd-c-blue text\s*\{[^}]*fill: #E6F1FB/);
  });
});

describe('buildStandaloneSVG', () => {
  it('embeds the design-system stylesheet into a valid exported document', () => {
    const standalone = buildStandaloneSVG(MINIMAL_SVG, buildDiagramRules(tokens, false));
    const doc = parseSvg(standalone);

    expect(doc.querySelector('parsererror')).toBeNull();
    const style = doc.querySelector('svg > defs > style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.svgd-box');
    expect(doc.querySelector('rect')?.getAttribute('class')).toBe('svgd-box');
  });

  it('returns input unchanged when no svg tag exists', () => {
    expect(buildStandaloneSVG('plain text', 'rules')).toBe('plain text');
  });

  it('produces valid XML when a token value contains an ampersand', () => {
    const rules = buildDiagramRules({ ...tokens, fontFamily: '"A & B", sans-serif' }, false);

    const doc = parseSvg(buildStandaloneSVG(MINIMAL_SVG, rules));

    expect(doc.querySelector('parsererror')).toBeNull();
    // the escaped entity decodes back to a literal `&` in the CSSOM text
    expect(doc.querySelector('style')?.textContent).toContain('"A & B"');
  });

  it('keeps a closing-style/script sentinel as inert text', () => {
    const rules = buildDiagramRules(
      { ...tokens, fontFamily: 'x</style><script>window.__pwn=1</script><style>y' },
      false,
    );

    const doc = parseSvg(buildStandaloneSVG(MINIMAL_SVG, rules));

    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('style')?.textContent).toContain('</style><script>');
  });

  it('serializes real sanitizer output (HTML entities) as valid XML', () => {
    // sanitizeSVGContent returns HTML serialization, so ordinary diagram text
    // with a non-breaking space comes back as the `&nbsp;` named entity, which
    // is undefined in image/svg+xml — the export must normalize it to XML
    const body = sanitizeSVGContent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 100" role="img">
         <defs>
           <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
             <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke"/>
           </marker>
         </defs>
         <text class="t">A${NBSP}B</text>
         <line class="arr" x1="0" y1="0" x2="9" y2="9" marker-end="url(#arrow)"/>
       </svg>`,
    );
    expect(body).toContain('&nbsp;');

    const doc = parseSvg(buildStandaloneSVG(body, buildDiagramRules(tokens, false)));

    expect(doc.querySelector('parsererror')).toBeNull();
    // U+00A0 survives; the stylesheet and the namespaced class + marker
    // reference/target pair all round-trip through the XML serialization
    expect(doc.querySelector('text')?.textContent).toContain(NBSP);
    expect(doc.querySelector('svg > defs > style')?.textContent).toContain('.svgd-t');
    expect(doc.querySelector('text')?.getAttribute('class')).toBe('svgd-t');
    expect(doc.querySelector('marker')?.getAttribute('id')).toBe('svgd-arrow');
    expect(doc.querySelector('line')?.getAttribute('marker-end')).toBe('url(#svgd-arrow)');
  });
});
