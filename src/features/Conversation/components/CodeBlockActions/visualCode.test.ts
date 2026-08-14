import { describe, expect, it } from 'vitest';

import {
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
  it('is true for svg or full html, false otherwise', () => {
    expect(isVisualCode('<svg></svg>', '')).toBe(true);
    expect(isVisualCode('<!DOCTYPE html>', '')).toBe(true);
    expect(isVisualCode('print(1)', 'python')).toBe(false);
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

  it('treats an html-language fragment as complete (renders by default)', () => {
    expect(isVisualComplete('<div class="card">done</div>', 'html')).toBe(true);
  });
});
