import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { providerUsageRouter } from '../providerUsage';

const usage = vi.hoisted(() => ({
  getUsage: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/providerUsage', () => ({
  ProviderUsageService: class {
    getUsage = usage.getUsage;
  },
}));

const createCaller = (accountScope?: string) =>
  providerUsageRouter.createCaller({
    accountScope,
    clerkAuth: { userId: 'account-a' },
    userId: 'account-a',
  } as never);

describe('providerUsageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    usage.getUsage.mockResolvedValue({ provider: 'deepseek', status: 'ok' });
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'user:account-b'],
  ])('rejects a %s account scope before reading keys', async (_caseName, accountScope) => {
    await expect(
      createCaller(accountScope).get({ accountScope: 'user:account-a', provider: 'deepseek' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(usage.getUsage).not.toHaveBeenCalled();
  });

  it('rejects compatible and custom providers', async () => {
    await expect(
      createCaller('user:account-a').get({
        accountScope: 'user:account-a',
        provider: 'openaicompatible',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(usage.getUsage).not.toHaveBeenCalled();
  });

  it('reads usage for a supported provider', async () => {
    await expect(
      createCaller('user:account-a').get({ accountScope: 'user:account-a', provider: 'deepseek' }),
    ).resolves.toEqual({ provider: 'deepseek', status: 'ok' });
    expect(usage.getUsage).toHaveBeenCalledWith('deepseek');
  });

  it('forces a fresh read on refresh', async () => {
    await createCaller('user:account-a').refresh({
      accountScope: 'user:account-a',
      provider: 'moonshot',
    });
    expect(usage.getUsage).toHaveBeenCalledWith('moonshot', { force: true });
  });
});
