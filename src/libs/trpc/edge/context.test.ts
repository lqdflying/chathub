import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOKEN_AUTH_USER_HEADER } from '@/const/auth';
import { ClerkAuth } from '@/libs/clerk-auth';

import { createEdgeContext } from './context';

const authFlags = vi.hoisted(() => ({
  enableClerk: false,
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  get enableClerk() {
    return authFlags.enableClerk;
  },
  enableNextAuth: false,
  enableTokenAuth: true,
}));

vi.mock('@/libs/clerk-auth', () => ({
  ClerkAuth: vi.fn(),
}));

describe('createEdgeContext token authentication', () => {
  beforeEach(() => {
    authFlags.enableClerk = false;
    vi.clearAllMocks();
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

  it('preserves the raw Clerk principal when the database owner is mapped', async () => {
    authFlags.enableClerk = true;
    vi.mocked(ClerkAuth).mockImplementation(
      () =>
        ({
          getAuthFromRequest: vi.fn(() => ({
            clerkAuth: { userId: 'dev-account' },
            userId: 'prod-account',
          })),
        }) as never,
    );
    const request = new NextRequest('https://chathub.example/trpc/edge/config.getGlobalConfig');

    await expect(createEdgeContext(request)).resolves.toMatchObject({
      clerkAuth: { userId: 'dev-account' },
      rawAuthUserId: 'dev-account',
      userId: 'prod-account',
    });
  });
});
