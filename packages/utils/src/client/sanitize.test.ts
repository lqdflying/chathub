/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { sanitizeSVGContent } from './sanitize';

// This suite runs under jsdom instead of the repo-default happy-dom: DOMPurify
// does not support happy-dom (attribute filtering silently no-ops and removing
// a node breaks sibling traversal there — capricorn86/happy-dom#1629, #1810),
// which would make every attribute-level assertion below vacuous.

describe('sanitizeSVGContent', () => {
  it('should preserve safe SVG elements and attributes', () => {
    const safeSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="red" stroke="blue" stroke-width="2" />
        <rect x="10" y="10" width="30" height="30" fill="green" />
        <path d="M10,20 L30,40" stroke="black" />
      </svg>
    `;

    const sanitized = sanitizeSVGContent(safeSvg);

    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('fill="red"');
    expect(sanitized).toContain('<rect');
    expect(sanitized).toContain('<path');
  });

  it('should remove dangerous script tags', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('XSS')</script>
        <circle cx="50" cy="50" r="40" fill="red" />
      </svg>
    `;

    const sanitized = sanitizeSVGContent(maliciousSvg);

    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('alert');
    expect(sanitized).toContain('<svg');
  });

  it('should remove dangerous event handler attributes', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="40" fill="red" onclick="alert('click')" onload="alert('load')" />
      </svg>
    `;

    const sanitized = sanitizeSVGContent(maliciousSvg);

    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onload');
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('fill="red"');
  });

  it('should remove dangerous embed and object tags', () => {
    // the circle comes first: embed/object are HTML foreign-content breakout
    // tags, so per spec parsing everything after them is ejected from the SVG
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="40" fill="red" />
        <object data="malicious.swf"></object>
        <embed src="malicious.swf"></embed>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(maliciousSvg);

    expect(sanitized).not.toContain('<object');
    expect(sanitized).not.toContain('<embed');
    expect(sanitized).not.toContain('malicious.swf');
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('fill="red"');
  });

  it('should handle empty or invalid SVG content gracefully', () => {
    expect(sanitizeSVGContent('')).toBe('');
    expect(sanitizeSVGContent('<invalid>content</invalid>')).toBe('');
  });

  it('should handle SVG without leading whitespace', () => {
    // the real production shape: artifactCode() yields code starting directly
    // with <svg, which happy-dom's parser turned into an empty string
    const bareSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 100" role="img"><rect class="box" x="40" y="40" width="120" height="44" rx="8"/></svg>`;

    const sanitized = sanitizeSVGContent(bareSvg);

    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('class="box"');
    expect(sanitized).toContain('role="img"');
  });

  it('should preserve the diagram design-system vocabulary', () => {
    const diagramSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 680 240" role="img">
        <title>Login flow</title>
        <desc>Three-step flowchart from request to session</desc>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke"/>
          </marker>
        </defs>
        <g class="c-blue">
          <rect x="40" y="40" width="180" height="56" rx="8"/>
          <text x="130" y="64" class="th" text-anchor="middle">Client</text>
          <text x="130" y="82" class="ts" text-anchor="middle">
            <tspan x="130">sends credentials</tspan>
          </text>
        </g>
        <rect class="box" x="40" y="140" width="180" height="44" rx="8"/>
        <line class="arr" x1="130" y1="96" x2="130" y2="138" marker-end="url(#arrow)"/>
        <line class="leader" x1="220" y1="68" x2="300" y2="68" stroke-dasharray="4 3"/>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(diagramSvg);

    expect(sanitized).toContain('role="img"');
    expect(sanitized).toContain('<title>Login flow</title>');
    expect(sanitized).toContain('<desc>');
    expect(sanitized).toContain('viewBox="0 0 680 240"');
    expect(sanitized).toContain('<marker');
    expect(sanitized).toContain('id="arrow"');
    expect(sanitized).toContain('fill="context-stroke"');
    expect(sanitized).toContain('class="c-blue"');
    expect(sanitized).toContain('class="th"');
    expect(sanitized).toContain('class="box"');
    expect(sanitized).toContain('class="arr"');
    expect(sanitized).toContain('marker-end="url(#arrow)"');
    expect(sanitized).toContain('text-anchor="middle"');
    expect(sanitized).toContain('<tspan');
    expect(sanitized).toContain('stroke-dasharray="4 3"');
  });

  it('should strip style/use/foreignObject from hostile diagram input', () => {
    const hostileSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 100" role="img">
        <rect class="box" x="10" y="10" width="100" height="40"/>
        <style>.t { fill: red; }</style>
        <script>alert('xss')</script>
        <use href="#evil"/>
        <foreignObject width="100" height="100"><div>html</div></foreignObject>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(hostileSvg);

    expect(sanitized).not.toContain('<style');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<use');
    expect(sanitized).not.toContain('foreignObject');
    expect(sanitized).toContain('class="box"');
    expect(sanitized).toContain('role="img"');
  });

  it('should block UI-redress and remote-resource vectors', () => {
    const attack = `
      <svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;inset:0;width:100vw;height:100vh;z-index:999999">
        <rect class="box" width="10" height="10"/>
        <image href="https://attacker.example/pixel.png" />
        <image xlink:href="//attacker.example/pixel2.png" />
        <a href="https://attacker.example/login"><text class="t">Continue</text></a>
        <a href="javascript:alert(1)"><text class="t">Click</text></a>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(attack);

    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('position:fixed');
    expect(sanitized).not.toContain('<image');
    expect(sanitized).not.toContain('<a');
    expect(sanitized).not.toContain('href');
    expect(sanitized).not.toContain('attacker.example');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).toContain('class="box"');
  });

  it('should restrict url() references to same-document marker lookups', () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <line x1="0" y1="0" x2="9" y2="9" class="arr" marker-end="url(#arrow)"/>
        <line x1="0" y1="9" x2="9" y2="0" class="arr" marker-end="url(https://attacker.example/m.svg#a)"/>
        <rect x="1" y="1" width="10" height="10" fill="url(#grad1)"/>
        <rect x="20" y="1" width="10" height="10" fill="url(https://attacker.example/paint.svg#p)"/>
        <rect x="40" y="1" width="10" height="10" stroke="url(//attacker.example/p.svg#x)"/>
        <rect x="60" y="1" width="10" height="10" fill="url(data:image/svg+xml;base64,PHN2Zz4=)"/>
        <circle cx="5" cy="5" r="4" fill="u\\72l(https://attacker.example/e.svg#p)"/>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(svg);

    expect(sanitized).toContain('marker-end="url(#arrow)"');
    // gradients are not part of the vocabulary, so fill/stroke never keep
    // url() values — not even same-document ones
    expect(sanitized).not.toContain('url(#grad1)');
    expect(sanitized).not.toContain('attacker.example');
    expect(sanitized).not.toContain('data:');
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('<rect');
  });

  it('should preserve complex SVG structures while removing threats', () => {
    const complexSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="grad1">
            <stop offset="0%" stop-color="red" />
            <stop offset="100%" stop-color="blue" />
          </linearGradient>
        </defs>
        <g transform="translate(50,50)">
          <script>malicious()</script>
          <circle cx="50" cy="50" r="40" fill="url(#grad1)" onclick="hack()" />
          <text x="50" y="60" text-anchor="middle" onload="evil()">Hello</text>
        </g>
      </svg>
    `;

    const sanitized = sanitizeSVGContent(complexSvg);

    // gradients are outside the diagram vocabulary and get stripped
    expect(sanitized).not.toContain('<linearGradient');
    expect(sanitized).not.toContain('stop-color');
    expect(sanitized).not.toContain('url(#grad1)');
    expect(sanitized).toContain('transform="translate(50,50)"');
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('malicious');
    expect(sanitized).toContain('<circle');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).toContain('Hello');
    expect(sanitized).not.toContain('onload');
  });
});
