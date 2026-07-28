import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';

import { apiKeyRouter } from '../apiKey';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

describe('apiKeyRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['guest', 'guest'],
    ['foreign', 'user:account-b'],
  ])('rejects a %s account scope before database access', async (_caseName, accountScope) => {
    const caller = apiKeyRouter.createCaller({
      accountScope,
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.getApiKeys()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
    expect(getServerDB).not.toHaveBeenCalled();
  });
});
