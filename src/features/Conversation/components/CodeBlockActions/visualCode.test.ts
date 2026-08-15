import { describe, expect, it } from 'vitest';

import {
  injectSandboxShim,
  isHtmlCode,
  isHtmlDocument,
  isSvgCode,
  isVisualCode,
  isVisualComplete,
} from './visualCode';

describe('isHtmlDocument', () => {
  it('detects a full document, not a fragment', () => {
    expect(isHtmlDocument('<!DOCTYPE html><html></html>')).toBe(true);
    expect(isHtmlDocument('  <html lang="en">')).toBe(true);
    expect(isHtmlDocument('<div class="card">done</div>')).toBe(false);
  });
});

describe('isSvgCode', () => {
  it('detects the svg language', () => {
    expect(isSvgCode('anything', 'svg')).toBe(true);
  });

  it('detects <svg by content even when the block is mislabeled', () => {
    expect(isSvgCode('  <svg viewBox="0 0 1 1"></svg>', 'plaintext')).toBe(true);
    expect(isSvgCode('<svg xmlns="...">', '')).toBe(true);
  });

  it('rejects non-svg content', () => {
    expect(isSvgCode('const a = 1;', 'ts')).toBe(false);
    expect(isSvgCode('a <svg> in prose', '')).toBe(false);
  });
});

describe('isHtmlCode', () => {
  it('detects the html language', () => {
    expect(isHtmlCode('<div>x</div>', 'html')).toBe(true);
  });

  it('detects a full document regardless of label', () => {
    expect(isHtmlCode('<!DOCTYPE html><html></html>', 'plaintext')).toBe(true);
    expect(isHtmlCode('<html lang="en">', '')).toBe(true);
  });

  it('rejects a bare fragment when the language is not html', () => {
    expect(isHtmlCode('<div>hi</div>', '')).toBe(false);
  });
});

describe('isVisualCode', () => {
  it('inlines svg and full html documents only', () => {
    expect(isVisualCode('<svg></svg>', '')).toBe(true);
    expect(isVisualCode('<!DOCTYPE html>', '')).toBe(true);
    expect(isVisualCode('print(1)', 'python')).toBe(false);
  });

  it('does not inline a bare html fragment (it stays source)', () => {
    // a fragment has no closing-document marker, so it can't be stream-gated
    // and would otherwise mount/run repeatedly mid-stream
    expect(isVisualCode('<div class="card">done</div>', 'html')).toBe(false);
  });
});

describe('isVisualComplete', () => {
  it('treats svg complete only once the closing tag arrives', () => {
    expect(isVisualComplete('<svg><rect/>', 'svg')).toBe(false);
    expect(isVisualComplete('<svg><rect/></svg>', 'svg')).toBe(true);
  });

  it('treats a full html document complete only on </html> or </body>', () => {
    expect(isVisualComplete('<!DOCTYPE html><html><body>', 'html')).toBe(false);
    expect(isVisualComplete('<!DOCTYPE html><html><body></body></html>', 'html')).toBe(true);
    expect(isVisualComplete('<html><body>x</body>', 'html')).toBe(true);
  });
});

describe('injectSandboxShim', () => {
  const SHIM = '<script>';
  const STUB = "['localStorage','sessionStorage']";

  it('inserts the shim right after <head> when present', () => {
    const out = injectSandboxShim(
      '<!doctype html><html><head><title>t</title></head><body>x</body></html>',
    );
    expect(out).toContain(STUB);
    // the shim sits immediately after the opening <head> tag, before <title>
    expect(out.indexOf(SHIM)).toBe(out.indexOf('<head>') + '<head>'.length);
    expect(out.indexOf(SHIM)).toBeLessThan(out.indexOf('<title>'));
    // original document content is preserved
    expect(out).toContain('<title>t</title>');
    expect(out).toContain('<body>x</body>');
  });

  it('respects head attributes and does not match <header>', () => {
    const out = injectSandboxShim(
      '<html><head data-x="1"><header>h</header></head><body></body></html>',
    );
    // inserted after the real <head ...>, not before the <header> element
    expect(out.indexOf(SHIM)).toBe(out.indexOf('<head data-x="1">') + '<head data-x="1">'.length);
    expect(out.indexOf(SHIM)).toBeLessThan(out.indexOf('<header>'));
  });

  it('falls back to after <html> when there is no head', () => {
    const out = injectSandboxShim('<html><body>only body</body></html>');
    expect(out.indexOf(SHIM)).toBe(out.indexOf('<html>') + '<html>'.length);
    expect(out).toContain('<body>only body</body>');
  });

  it('falls back to after <!doctype> when there is no head or html tag', () => {
    const out = injectSandboxShim('<!doctype html>plain');
    expect(out.startsWith('<!doctype html><script>')).toBe(true);
    expect(out.endsWith('plain')).toBe(true);
  });

  it('prepends when there is no doctype/head/html anchor', () => {
    const out = injectSandboxShim('just markup');
    expect(out.startsWith(SHIM)).toBe(true);
    expect(out.endsWith('just markup')).toBe(true);
  });
});
