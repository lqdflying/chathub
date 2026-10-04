/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { OutputCollector, truncateMiddle } from '../text';

describe('truncateMiddle', () => {
  it('returns short text unchanged', () => {
    expect(truncateMiddle('hello', 10)).toBe('hello');
  });

  it('keeps the head and tail of long text', () => {
    expect(truncateMiddle('abcdefghij', 4)).toBe('ab\n…[6 characters omitted]…\nij');
  });
});

describe('OutputCollector', () => {
  it('joins lines with newlines, keeping empty lines', () => {
    const output = new OutputCollector(100);
    for (const line of ['', 'a', '', 'b']) output.push(line);
    expect(output.toString()).toBe('\na\n\nb');
    expect(output.length).toBe(5);
  });

  it('keeps everything up to the cap', () => {
    const output = new OutputCollector(7);
    output.push('abc');
    output.push('def');
    expect(output.toString()).toBe('abc\ndef');
  });

  it('keeps the first and last halves of a long stream', () => {
    const output = new OutputCollector(10);
    for (let index = 0; index < 1000; index += 1) output.push(String(index % 10));
    const text = output.toString();
    expect(text.startsWith('0\n1\n2')).toBe(true);
    expect(text.endsWith('\n8\n9')).toBe(true);
    expect(text).toContain(`…[${output.length - 10} characters omitted]…`);
  });

  it('bounds a single huge chunk', () => {
    const output = new OutputCollector(8);
    output.append('x'.repeat(100_000));
    expect(output.toString()).toBe('xxxx\n…[99992 characters omitted]…\nxxxx');
  });
});
