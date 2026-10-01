import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    tokenEstimation: {
      getMultiplier: { query },
    },
  },
}));

describe('getTokenEstimateMultiplier', () => {
  beforeEach(() => {
    query.mockReset();
    vi.resetModules();
  });

  it('shares one ordinary request and lets a fresh request bypass it', async () => {
    const pending: Array<(value: { multiplier: number }) => void> = [];
    query.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const { getTokenEstimateMultiplier } = await import('./tokenEstimation');

    const first = getTokenEstimateMultiplier('openai', 'gpt-5-mini');
    const second = getTokenEstimateMultiplier('openai', 'gpt-5-mini');
    const fresh = getTokenEstimateMultiplier('openai', 'gpt-5-mini', { fresh: true });
    expect(query).toHaveBeenCalledTimes(2);

    for (const resolve of pending) resolve({ multiplier: 1.2 });
    await expect(Promise.all([first, second, fresh])).resolves.toEqual([1.2, 1.2, 1.2]);
  });

  it('keeps the newer multiplier when an older response arrives later', async () => {
    const pending: Array<(value: { multiplier: number }) => void> = [];
    query.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const { getTokenEstimateMultiplier, invalidateTokenEstimateMultiplier } = await import(
      './tokenEstimation'
    );

    const ordinary = getTokenEstimateMultiplier('openai', 'gpt-5-mini');
    invalidateTokenEstimateMultiplier();
    const fresh = getTokenEstimateMultiplier('openai', 'gpt-5-mini', { fresh: true });
    expect(query).toHaveBeenCalledTimes(2);

    pending[1]({ multiplier: 1.8 });
    await expect(fresh).resolves.toBe(1.8);
    pending[0]({ multiplier: 1 });
    await ordinary;

    query.mockClear();
    await expect(getTokenEstimateMultiplier('openai', 'gpt-5-mini')).resolves.toBe(1.8);
    expect(query).not.toHaveBeenCalled();
  });
});
