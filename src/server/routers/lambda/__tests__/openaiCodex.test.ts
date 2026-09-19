import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { openaiCodexRouter } from '../openaiCodex';

const oauth = vi.hoisted(() => ({
  getStatus: vi.fn(),
  logout: vi.fn(),
  pollDeviceLogin: vi.fn(),
  startDeviceLogin: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/services/openaiCodex/oauth', () => ({
  OpenAICodexOAuthService: class {
    getStatus = oauth.getStatus;
    logout = oauth.logout;
    pollDeviceLogin = oauth.pollDeviceLogin;
    startDeviceLogin = oauth.startDeviceLogin;
  },
}));

describe('openaiCodexRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    oauth.getStatus.mockResolvedValue({ connected: true, email: 'plus@example.com' });
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'user:account-b'],
  ])('rejects a %s account scope before reading tokens', async (_caseName, accountScope) => {
    const caller = openaiCodexRouter.createCaller({
      accountScope,
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.status({ accountScope: 'user:account-a' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(oauth.getStatus).not.toHaveBeenCalled();
  });

  it('returns status for the authenticated account', async () => {
    const caller = openaiCodexRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.status({ accountScope: 'user:account-a' })).resolves.toEqual({
      connected: true,
      email: 'plus@example.com',
    });
    expect(oauth.getStatus).toHaveBeenCalledWith('account-a');
  });
});
