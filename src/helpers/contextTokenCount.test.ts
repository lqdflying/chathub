import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/tokenizer', () => ({
  countTokensDetailed: vi.fn(),
  fallbackTokenCount: (text: string) => Math.ceil(text.length / 4),
}));

import { countTokensDetailed } from '@/utils/tokenizer';

import { clearContextTokenCache, countContextTextTokens } from './contextTokenCount';

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
});
