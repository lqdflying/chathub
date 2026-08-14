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

describe('buildDiagramRules', () => {
  it('scopes typography and ink to the explicit text classes only', () => {
    const rules = buildDiagramRules(tokens, false);

    expect(rules).toContain('text.t');
    expect(rules).toContain('text.ts');
    expect(rules).toContain('text.th');
    // a bare `text` selector (unqualified by a class like `text.t` or a
    // `.c-*` ancestor) would override authored presentation attributes in
    // legacy SVGs — it must never exist
    expect(rules).not.toMatch(/(?:^|[,}])\s*text\s*[,{]/);
  });

  it('styles the shape and connector classes', () => {
    const rules = buildDiagramRules(tokens, false);

    expect(rules).toMatch(/\.box\s*\{[^}]*fill: #f5f5f5/);
    expect(rules).toMatch(/\.arr\s*\{[^}]*stroke: #888888/);
    expect(rules).toMatch(/\.leader\s*\{[^}]*stroke-dasharray: 4 3/);
  });

  it('flips ramp fills between light and dark mode', () => {
    const light = buildDiagramRules(tokens, false);
    const dark = buildDiagramRules(tokens, true);

    expect(light).toMatch(/\.c-blue rect[^{]*\{[^}]*fill: #E6F1FB/);
    expect(dark).toMatch(/\.c-blue rect[^{]*\{[^}]*fill: #042C53/);
    expect(light).toMatch(/\.c-blue text\s*\{[^}]*fill: #042C53/);
    expect(dark).toMatch(/\.c-blue text\s*\{[^}]*fill: #E6F1FB/);
  });
});

describe('buildStandaloneSVG', () => {
  it('embeds the stylesheet right after the opening svg tag', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 100"><rect class="box" x="1"/></svg>';
    const rules = buildDiagramRules(tokens, false);

    const standalone = buildStandaloneSVG(svg, rules);

    expect(
      standalone.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 100"><defs><style>',
      ),
    ).toBe(true);
    expect(standalone).toContain('</style></defs><rect class="box"');
    expect(standalone).toContain('.box');
    expect(standalone.endsWith('</svg>')).toBe(true);
  });

  it('returns input unchanged when no svg tag exists', () => {
    expect(buildStandaloneSVG('plain text', 'rules')).toBe('plain text');
  });
});
