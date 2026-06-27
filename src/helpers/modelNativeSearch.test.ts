import { describe, expect, it } from 'vitest';

import { isModelNativeSearchDisabledProvider } from './modelNativeSearch';

describe('isModelNativeSearchDisabledProvider', () => {
  it.each(['moonshot'])(
    'returns true for %s',
    (provider) => {
      expect(isModelNativeSearchDisabledProvider(provider)).toBe(true);
    },
  );

  it.each(['openai', 'anthropic', 'deepseek', 'google', 'minimax', 'azure', 'openaicompatible', 'anthropiccompatible'])(
    'returns false for %s',
    (provider) => {
      expect(isModelNativeSearchDisabledProvider(provider)).toBe(false);
    },
  );

  it('returns false for undefined', () => {
    expect(isModelNativeSearchDisabledProvider(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isModelNativeSearchDisabledProvider('')).toBe(false);
  });
});
