import { describe, expect, it } from 'vitest';

import {
  requestedCompletionCap,
  resolveInputBudgetTokens,
  resolveReservedOutputTokens,
} from './inputBudget';

describe('resolveInputBudgetTokens', () => {
  it('reserves a requested completion cap before the model card maximum', () => {
    expect(
      resolveReservedOutputTokens({
        contextWindowTokens: 258_000,
        maxOutput: 128_000,
        maxTokens: 4096,
      }),
    ).toBe(4096);
    expect(
      resolveInputBudgetTokens({
        contextWindowTokens: 258_000,
        maxOutput: 128_000,
        maxTokens: 4096,
      }),
    ).toBe(253_904);
  });

  it('reserves model max output only when it is lower than the context window', () => {
    expect(
      resolveInputBudgetTokens({ contextWindowTokens: 258_000, maxOutput: 128_000 }),
    ).toBe(130_000);
    expect(
      resolveInputBudgetTokens({ contextWindowTokens: 1_048_576, maxOutput: 1_048_576 }),
    ).toBe(1_048_576);
  });

  it('ignores a saved completion cap while the max-tokens switch is off', () => {
    expect(requestedCompletionCap(false, 4096)).toBeUndefined();
    expect(
      resolveInputBudgetTokens({
        contextWindowTokens: 258_000,
        maxOutput: 128_000,
        maxTokens: requestedCompletionCap(false, 4096),
      }),
    ).toBe(130_000);
    expect(
      resolveInputBudgetTokens({
        contextWindowTokens: 258_000,
        maxOutput: 128_000,
        maxTokens: requestedCompletionCap(true, 4096),
      }),
    ).toBe(253_904);
  });

  it('returns zero when the context window is unknown', () => {
    expect(resolveInputBudgetTokens({})).toBe(0);
  });
});
