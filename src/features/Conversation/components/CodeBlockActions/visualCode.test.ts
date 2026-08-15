// @vitest-environment jsdom
// jsdom gives a spec-accurate HTML parser so the injectSandboxShim tests can
// assert PARSED-DOM semantics (head/html attributes, script placement), not just
// string containment — a substring test can pass while the shim is inert.
import { describe, expect, it } from 'vitest';

import {
  injectSandboxShim,
  isHtmlCode,
  isHtmlDocument,
  isSvgCode,
  isVisualCode,
  isVisualComplete,
} from './visualCode';

const parseDoc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

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
  const STUB = "['localStorage','sessionStorage']";
  // the shim is the first <script> in the parsed <head>
  const headShim = (d: Document) => d.head.querySelector('script')?.textContent ?? '';
  const bodyScripts = (d: Document) =>
    [...d.querySelectorAll('body script')].map((s) => s.textContent);

  it('preserves authored <head>/<html> attributes and runs the shim first (finding r15/1)', () => {
    const doc =
      '<!doctype html><html lang="en"><head id="cfg" data-config="kept"><title>t</title></head>' +
      '<body><script>void localStorage</script></body></html>';
    const d = parseDoc(injectSandboxShim(doc));
    // authored head + html attributes survive (the round-15 regression)
    expect(d.documentElement.getAttribute('lang')).toBe('en');
    expect(d.head.getAttribute('id')).toBe('cfg');
    expect(d.head.dataset.config).toBe('kept');
    // the shim is the FIRST element in <head>, ahead of authored <title>/scripts
    expect(d.head.firstElementChild?.tagName).toBe('SCRIPT');
    expect(d.head.firstElementChild?.textContent).toContain(STUB);
    expect(d.head.querySelector('title')?.textContent).toBe('t');
    // doctype preserved verbatim
    expect(injectSandboxShim(doc).toLowerCase().startsWith('<!doctype html>')).toBe(true);
  });

  it('preserves head attributes for a no-doctype document', () => {
    const d = parseDoc(
      injectSandboxShim(
        '<html lang="fr"><head data-config="no-doctype"></head><body></body></html>',
      ),
    );
    expect(d.documentElement.getAttribute('lang')).toBe('fr');
    expect(d.head.dataset.config).toBe('no-doctype');
    expect(headShim(d)).toContain(STUB);
  });

  it('is not fooled by a fake <head> inside a <script> string; authored scripts stay intact', () => {
    const doc =
      '<!doctype html><html><body>' +
      '<script>const marker = "<head>";</script>' +
      '<script>void localStorage</script>' +
      '</body></html>';
    const d = parseDoc(injectSandboxShim(doc));
    // shim went into the (synthesized) head, not inside the authored script
    expect(headShim(d)).toContain(STUB);
    // both authored scripts survive with exact text
    expect(bodyScripts(d)).toContain('const marker = "<head>";');
    expect(bodyScripts(d)).toContain('void localStorage');
  });

  it('is not fooled by a fake <head> inside a quoted attribute', () => {
    const d = parseDoc(
      injectSandboxShim('<!doctype html><html data-note="<head>"><body></body></html>'),
    );
    expect(d.documentElement.dataset.note).toBe('<head>');
    expect(headShim(d)).toContain(STUB);
  });

  it('inserts the shim after a real <head> even when a comment precedes it', () => {
    const d = parseDoc(
      injectSandboxShim(
        '<!doctype html><!-- c --><html><head id="real"></head><body></body></html>',
      ),
    );
    expect(d.head.getAttribute('id')).toBe('real');
    expect(headShim(d)).toContain(STUB);
  });

  it('injects into a synthesized head when the document omits <head>', () => {
    const d = parseDoc(
      injectSandboxShim(
        '<!doctype html><html><body><script>void localStorage</script></body></html>',
      ),
    );
    expect(headShim(d)).toContain(STUB);
    expect(bodyScripts(d)).toContain('void localStorage');
  });

  it('prepends when there is no leading doctype/html/head anchor', () => {
    const out = injectSandboxShim('just markup');
    expect(out.startsWith('<script>')).toBe(true);
    expect(out.endsWith('just markup')).toBe(true);
  });
});
