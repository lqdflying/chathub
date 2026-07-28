import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER, TOKEN_AUTH_USER_HEADER } from '@/const/auth';

import { createLambdaContext } from './context';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableClerk: false,
  enableNextAuth: false,
  enableTokenAuth: true,
}));

vi.mock('@/envs/oidc', () => ({
  oidcEnv: {
    ENABLE_OIDC: false,
  },
}));

describe('createLambdaContext account scope', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_TOKEN', 'access-token');
    vi.stubEnv('AUTH_USER_ID', 'account-a');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('copies the asserted account scope into the request context', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:account-a',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      accountScope: 'user:account-a',
      userId: 'account-a',
    });
  });

  it('rejects a forged token-auth user header without a valid bearer', async () => {
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:victim',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      accountScope: 'user:victim',
      rawAuthUserId: undefined,
      userId: undefined,
    });
  });

  it('derives token-auth identity from a valid bearer and ignores a forged user header', async () => {
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        Authorization: 'Bearer access-token',
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:account-a',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      accountScope: 'user:account-a',
      rawAuthUserId: 'account-a',
      userId: 'account-a',
    });
  });
});
