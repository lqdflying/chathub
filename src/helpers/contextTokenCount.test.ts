import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/tokenizer', () => ({
  countTokensDetailed: vi.fn(),
  fallbackTokenCount: (text: string) => Math.ceil(text.length / 4),
}));

import { countTokensDetailed } from '@/utils/tokenizer';

import {
  clearContextTokenCache,
  countContextTextTokens,
  readCachedContextTokens,
  warmContextTokenCache,
} from './contextTokenCount';

describe('countContextTextTokens', () => {
  beforeEach(() => {
    clearContextTokenCache();
    vi.mocked(countTokensDetailed).mockReset();
  });

  it('keeps a tokenizer failure out of the exact cache and retries later', async () => {
    vi.mocked(countTokensDetailed).mockResolvedValueOnce({ count: 80, mode: 'fallback' });
    await expect(countContextTextTokens('abcd'.repeat(20))).resolves.toEqual({
      count: 80,
      mode: 'fallback',
    });

    vi.mocked(countTokensDetailed).mockResolvedValueOnce({ count: 12, mode: 'exact' });
    await expect(countContextTextTokens('abcd'.repeat(20))).resolves.toEqual({
      count: 12,
      mode: 'exact',
    });
    await expect(countContextTextTokens('abcd'.repeat(20))).resolves.toEqual({
      count: 12,
      mode: 'exact',
    });
    expect(countTokensDetailed).toHaveBeenCalledTimes(2);
  });

  it('keeps a warm snapshot after the shared cache evicts those strings', async () => {
    vi.mocked(countTokensDetailed).mockImplementation(async (text: string) => ({
      count: text.length,
      mode: 'exact',
    }));
    const first = Array.from({ length: 450 }, (_, index) => `row-${index}-${'a'.repeat(12)}`);
    const warmed = await warmContextTokenCache(first);
    const later = Array.from({ length: 400 }, (_, index) => `later-${index}`);
    await warmContextTokenCache(later);

    expect(readCachedContextTokens(first[0])).toBeUndefined();
    expect(warmed.count(first[0])).toBe(first[0].length);
    expect(warmed.mode).toBe('exact');
    expect(first.reduce((sum, text) => sum + warmed.count(text), 0)).toBe(
      first.reduce((sum, text) => sum + text.length, 0),
    );
  });
});
