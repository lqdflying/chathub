/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { decodeText, formatNumberedLines, READ_MAX_CHARS, resolveTimeoutMs } from '../format';

describe('decodeText', () => {
  it('decodes UTF-8 text', () => {
    expect(decodeText(new Uint8Array(Buffer.from('héllo')))).toBe('héllo');
  });

  it('rejects NUL bytes and invalid UTF-8', () => {
    expect(decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBeUndefined();
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeUndefined();
  });
});

describe('formatNumberedLines', () => {
  it('numbers lines and ignores the trailing newline', () => {
    expect(formatNumberedLines('a\nb\n', {})).toEqual({
      content: '     1\ta\n     2\tb',
      endLine: 2,
      startLine: 1,
      totalLines: 2,
      truncated: false,
    });
  });

  it('returns a window with offset and limit', () => {
    const text = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
    expect(formatNumberedLines(text, { limit: 2, offset: 4 })).toMatchObject({
      content: '     4\tline 4\n     5\tline 5',
      endLine: 5,
      startLine: 4,
      totalLines: 10,
      truncated: true,
    });
  });

  it('handles an empty file and an offset past the end', () => {
    expect(formatNumberedLines('', {})).toMatchObject({ content: '', totalLines: 0, truncated: false });
    expect(formatNumberedLines('a', { offset: 5 })).toMatchObject({
      content: '',
      endLine: undefined,
      truncated: false,
    });
  });

  it('cuts very long lines and stops at the character budget', () => {
    const long = formatNumberedLines('x'.repeat(5000), {});
    expect(long.content.endsWith('…[line truncated]')).toBe(true);

    const wide = Array.from({ length: 200 }, () => 'y'.repeat(1900)).join('\n');
    const result = formatNumberedLines(wide, {});
    expect(result.content.length).toBeLessThanOrEqual(READ_MAX_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.endLine).toBeLessThan(200);
  });
});

describe('resolveTimeoutMs', () => {
  const limits = { defaultMs: 60_000, maxMs: 600_000 };

  it('uses the default when omitted or invalid', () => {
    expect(resolveTimeoutMs(undefined, limits)).toBe(60_000);
    expect(resolveTimeoutMs(0, limits)).toBe(60_000);
    expect(resolveTimeoutMs(Number.NaN, limits)).toBe(60_000);
  });

  it('converts seconds and clamps to the limits', () => {
    expect(resolveTimeoutMs(120, limits)).toBe(120_000);
    expect(resolveTimeoutMs(0.1, limits)).toBe(1000);
    expect(resolveTimeoutMs(100_000, limits)).toBe(600_000);
  });

  it('never lowers an operator default that is above the maximum', () => {
    expect(resolveTimeoutMs(5000, { defaultMs: 900_000, maxMs: 600_000 })).toBe(900_000);
  });
});
