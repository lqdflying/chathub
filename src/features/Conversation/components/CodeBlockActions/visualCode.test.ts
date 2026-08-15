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

  it('inserts the shim right after a leading doctype, before <html>', () => {
    const doc = '<!doctype html><html><head><title>t</title></head><body>x</body></html>';
    const out = injectSandboxShim(doc);
    expect(out).toContain(STUB);
    // right after the doctype, before any authored node (<html>/<head>/<title>)
    expect(out.indexOf(SHIM)).toBe('<!doctype html>'.length);
    expect(out.indexOf(SHIM)).toBeLessThan(out.indexOf('<html>'));
    // original document content is preserved intact
    expect(out).toContain('<html><head><title>t</title></head>');
    expect(out).toContain('<body>x</body>');
  });

  it('prepends the shim when there is no doctype (leading <html>)', () => {
    const out = injectSandboxShim('<html lang="en"><head></head><body></body></html>');
    expect(out.indexOf(SHIM)).toBe(0);
    expect(out).toContain('<html lang="en"><head></head>');
  });

  it('anchors on the leading doctype even when a comment precedes <html>', () => {
    const out = injectSandboxShim('<!doctype html><!-- c --><html><head></head></html>');
    expect(out.indexOf(SHIM)).toBe('<!doctype html>'.length);
    // the shim precedes the comment (and everything authored), so it runs first
    expect(out.indexOf(STUB)).toBeLessThan(out.indexOf('<!-- c -->'));
  });

  it('is not fooled by a fake <head> inside a later <script> string (finding r14/1)', () => {
    // no real <head> tag exists — only a `<head>` substring inside script text;
    // a whole-string search would inject into the script (its own </script>
    // would close the authored script) and be inert. The leading doctype anchor
    // is immune: it never looks past the boundary.
    const doc =
      '<!doctype html><html>' +
      '<script>const marker = "<head>";</script>' +
      '<script>void localStorage</script>' +
      '<body></body></html>';
    const out = injectSandboxShim(doc);
    // shim lands at the leading boundary, BEFORE the first authored script
    expect(out.indexOf(SHIM)).toBe('<!doctype html>'.length);
    expect(out.indexOf(STUB)).toBeLessThan(out.indexOf('<script>const marker'));
    expect(out.indexOf(STUB)).toBeLessThan(out.indexOf('void localStorage'));
    // and both authored scripts survive uncorrupted
    expect(out).toContain('<script>const marker = "<head>";</script>');
    expect(out).toContain('<script>void localStorage</script>');
  });

  it('is not fooled by a fake <head> inside a quoted attribute', () => {
    // a `>` inside the attribute would defeat any <html …> matcher; the doctype
    // anchor never parses the html tag, so the tag survives intact
    const out = injectSandboxShim('<!doctype html><html data-note="<head>"><body></body></html>');
    expect(out.indexOf(SHIM)).toBe('<!doctype html>'.length);
    expect(out).toContain('<html data-note="<head>">');
  });

  it('prepends when there is no leading doctype/html anchor', () => {
    const out = injectSandboxShim('just markup');
    expect(out.startsWith(SHIM)).toBe(true);
    expect(out.endsWith('just markup')).toBe(true);
  });
});
