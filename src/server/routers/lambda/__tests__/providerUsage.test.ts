import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { providerUsageRouter } from '../providerUsage';

const usage = vi.hoisted(() => ({
  deleteAdminCredential: vi.fn(),
  getUsage: vi.fn(),
  saveAdminCredential: vi.fn(),
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
    deleteAdminCredential = usage.deleteAdminCredential;
    getUsage = usage.getUsage;
    saveAdminCredential = usage.saveAdminCredential;
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

  it('saves an admin key only for admin providers and in the caller scope', async () => {
    usage.saveAdminCredential.mockResolvedValue({ provider: 'xai', status: 'ok' });
    const caller = createCaller('user:account-a');

    await expect(
      caller.saveAdminCredential({
        accountScope: 'user:account-a',
        apiKey: 'sk-12345678',
        provider: 'deepseek' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      createCaller('user:account-b').saveAdminCredential({
        accountScope: 'user:account-a',
        apiKey: 'xai-mgmt-key-123',
        provider: 'xai',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await caller.saveAdminCredential({
      accountScope: 'user:account-a',
      apiKey: '  xai-mgmt-key-123  ',
      provider: 'xai',
      teamId: ' team-1 ',
    });
    expect(usage.saveAdminCredential).toHaveBeenCalledTimes(1);
    expect(usage.saveAdminCredential).toHaveBeenCalledWith('xai', {
      apiKey: 'xai-mgmt-key-123',
      teamId: 'team-1',
    });
  });

  it('deletes a saved admin key', async () => {
    usage.deleteAdminCredential.mockResolvedValue({ provider: 'openai', status: 'noCredential' });
    await createCaller('user:account-a').deleteAdminCredential({
      accountScope: 'user:account-a',
      provider: 'openai',
    });
    expect(usage.deleteAdminCredential).toHaveBeenCalledWith('openai');
  });
});
