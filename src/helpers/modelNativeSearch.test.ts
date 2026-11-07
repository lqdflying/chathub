import { describe, expect, it } from 'vitest';

import {
  isModelNativeSearchDisabledProvider,
  resolveUseModelBuiltinSearch,
} from './modelNativeSearch';

describe('isModelNativeSearchDisabledProvider', () => {
  it.each(['moonshot'])('returns true for %s', (provider) => {
    expect(isModelNativeSearchDisabledProvider(provider)).toBe(true);
  });

  it.each([
    'openai',
    'anthropic',
    'deepseek',
    'google',
    'minimax',
    'azure',
    'openaicompatible',
    'anthropiccompatible',
    'mimo',
  ])('returns false for %s', (provider) => {
    expect(isModelNativeSearchDisabledProvider(provider)).toBe(false);
  });

  it('returns true for MiMo Token Plan hosts', () => {
    expect(
      isModelNativeSearchDisabledProvider('mimo', 'https://token-plan-cn.xiaomimimo.com/v1'),
    ).toBe(true);
    expect(isModelNativeSearchDisabledProvider('mimo', 'https://api.xiaomimimo.com/v1')).toBe(
      false,
    );
  });

  it('returns false for undefined', () => {
    expect(isModelNativeSearchDisabledProvider(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isModelNativeSearchDisabledProvider('')).toBe(false);
  });

  it('uses mimoTokenPlanEnv when Settings base URL is empty', () => {
    expect(isModelNativeSearchDisabledProvider('mimo', undefined, { mimoTokenPlanEnv: true })).toBe(
      true,
    );
    expect(
      isModelNativeSearchDisabledProvider('mimo', undefined, { mimoTokenPlanEnv: false }),
    ).toBe(false);
  });

  it('lets a Settings pay-as-you-go URL override env Token Plan', () => {
    expect(
      isModelNativeSearchDisabledProvider('mimo', 'https://api.xiaomimimo.com/v1', {
        mimoTokenPlanEnv: true,
      }),
    ).toBe(false);
  });
});

describe('resolveUseModelBuiltinSearch', () => {
  it.each([
    { expected: true, provider: 'deepseek', saved: undefined },
    { expected: false, provider: 'deepseek', saved: false },
    { expected: true, provider: 'anthropic', saved: undefined },
    { expected: false, provider: 'anthropic', saved: false },
    { expected: false, provider: 'anthropiccompatible', saved: undefined },
    { expected: false, provider: undefined, saved: undefined },
    { expected: false, provider: 'zhipu', saved: undefined },
    { expected: true, provider: 'zhipu', saved: true },
  ])('returns $expected for $provider with saved $saved', ({ expected, provider, saved }) => {
    expect(resolveUseModelBuiltinSearch(provider, saved)).toBe(expected);
  });
});
