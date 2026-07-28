import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOKEN_AUTH_USER_HEADER } from '@/const/auth';

import { createEdgeContext } from './context';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableClerk: false,
  enableNextAuth: false,
  enableTokenAuth: true,
}));

describe('createEdgeContext token authentication', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_TOKEN', 'access-token');
    vi.stubEnv('AUTH_USER_ID', 'account-a');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores a forged token-auth user header without a valid bearer', async () => {
    const request = new NextRequest('https://chathub.example/trpc/edge/config.getGlobalConfig', {
      headers: {
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });

    await expect(createEdgeContext(request)).resolves.toMatchObject({
      rawAuthUserId: undefined,
      userId: undefined,
    });
  });

  it('derives the configured user from a valid bearer', async () => {
    const request = new NextRequest('https://chathub.example/trpc/edge/config.getGlobalConfig', {
      headers: {
        Authorization: 'Bearer access-token',
        [TOKEN_AUTH_USER_HEADER]: 'victim',
      },
    });

    await expect(createEdgeContext(request)).resolves.toMatchObject({
      rawAuthUserId: 'account-a',
      userId: 'account-a',
    });
  });
});
