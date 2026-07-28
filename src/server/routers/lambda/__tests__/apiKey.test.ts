import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER, TOKEN_AUTH_USER_HEADER } from '@/const/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { apiKeyRouter } from '../apiKey';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
  enableClerk: false,
  enableNextAuth: false,
  enableTokenAuth: true,
}));

vi.mock('@/envs/oidc', () => ({
  oidcEnv: {
    ENABLE_OIDC: false,
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/apiKey');
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

describe('apiKeyRouter', () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_TOKEN', 'access-token');
    vi.stubEnv('AUTH_USER_ID', 'account-a');
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(ApiKeyModel).mockImplementation(() => ({ query }) as never);
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue({
      decrypt: vi.fn(),
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('rejects a forged token-auth user header before database access', async () => {
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:victim',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    const context = await createLambdaContext(request);
    const caller = apiKeyRouter.createCaller(context as never);

    await expect(caller.getApiKeys()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(getServerDB).not.toHaveBeenCalled();
  });

  it('propagates a valid bearer identity to the account-scoped model', async () => {
    query.mockResolvedValue([]);
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        Authorization: 'Bearer access-token',
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:account-a',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });
    const context = await createLambdaContext(request);
    const caller = apiKeyRouter.createCaller(context as never);

    await expect(caller.getApiKeys()).resolves.toEqual([]);

    expect(ApiKeyModel).toHaveBeenCalledWith(expect.anything(), 'account-a');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
