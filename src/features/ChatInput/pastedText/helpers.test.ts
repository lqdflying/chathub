import { describe, expect, it } from 'vitest';

import {
  PASTED_TEXT_MIN_CHARS,
  PASTED_TEXT_MIN_LINES,
  countPastedTextLines,
  getPastedTextPreview,
  hasClipboardFiles,
  joinPromptWithPastedText,
  shouldCollapsePastedText,
} from './helpers';

const lines = (count: number, text = 'line') =>
  Array.from({ length: count }, (_, index) => `${text} ${index + 1}`).join('\n');

describe('pasted text helpers', () => {
  it('counts lines including a trailing empty line', () => {
    expect(countPastedTextLines('')).toBe(0);
    expect(countPastedTextLines('one')).toBe(1);
    expect(countPastedTextLines('one\ntwo')).toBe(2);
    expect(countPastedTextLines('one\n')).toBe(2);
  });

  it('collapses at 10 lines even when under the character gate', () => {
    expect(shouldCollapsePastedText(lines(PASTED_TEXT_MIN_LINES - 1))).toBe(false);
    expect(shouldCollapsePastedText(lines(PASTED_TEXT_MIN_LINES))).toBe(true);
  });

  it('collapses at 1000 characters even as one line', () => {
    expect(shouldCollapsePastedText('a'.repeat(PASTED_TEXT_MIN_CHARS - 1))).toBe(false);
    expect(shouldCollapsePastedText('a'.repeat(PASTED_TEXT_MIN_CHARS))).toBe(true);
  });

  it('collapses a short line count that still hits the character gate', () => {
    expect(shouldCollapsePastedText(`${'a'.repeat(500)}\n${'b'.repeat(500)}`)).toBe(true);
  });

  it('builds a 6-line plain-text preview with a trailing ellipsis', () => {
    const preview = getPastedTextPreview(lines(8, 'row'));
    expect(preview).toBe('row 1\nrow 2\nrow 3\nrow 4\nrow 5\nrow 6…');
  });

  it('clips long preview lines', () => {
    const preview = getPastedTextPreview('x'.repeat(80));
    expect(preview).toBe(`${'x'.repeat(72)}…`);
  });

  it('joins the typed prompt first, then each paste body', () => {
    expect(joinPromptWithPastedText('explain this', ['dump one', 'dump two'])).toBe(
      'explain this\n\ndump one\n\ndump two',
    );
    expect(joinPromptWithPastedText('  ', ['dump'])).toBe('dump');
    expect(joinPromptWithPastedText('prompt', [])).toBe('prompt');
  });

  it('detects clipboard files without treating plain text as a file', () => {
    expect(
      hasClipboardFiles({
        files: { length: 0 } as FileList,
        items: [{ kind: 'string' }] as unknown as DataTransferItemList,
      } as DataTransfer),
    ).toBe(false);
    expect(
      hasClipboardFiles({
        files: { length: 1 } as FileList,
        items: [{ kind: 'file' }] as unknown as DataTransferItemList,
      } as DataTransfer),
    ).toBe(true);
  });
});
