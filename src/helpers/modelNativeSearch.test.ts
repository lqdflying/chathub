import { describe, expect, it } from 'vitest';

import { isModelNativeSearchDisabledProvider } from './modelNativeSearch';

describe('isModelNativeSearchDisabledProvider', () => {
  it.each(['moonshot'])(
    'returns true for %s',
    (provider) => {
      expect(isModelNativeSearchDisabledProvider(provider)).toBe(true);
    },
  );

  it.each(['openai', 'anthropic', 'deepseek', 'google', 'minimax', 'azure', 'openaicompatible', 'anthropiccompatible', 'mimo'])(
    'returns false for %s',
    (provider) => {
      expect(isModelNativeSearchDisabledProvider(provider)).toBe(false);
    },
  );

  it('returns true for MiMo Token Plan hosts', () => {
    expect(
      isModelNativeSearchDisabledProvider('mimo', 'https://token-plan-cn.xiaomimimo.com/v1'),
    ).toBe(true);
    expect(
      isModelNativeSearchDisabledProvider('mimo', 'https://api.xiaomimimo.com/v1'),
    ).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isModelNativeSearchDisabledProvider(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isModelNativeSearchDisabledProvider('')).toBe(false);
  });
});
