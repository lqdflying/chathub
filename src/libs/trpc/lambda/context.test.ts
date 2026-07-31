import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER, TOKEN_AUTH_USER_HEADER } from '@/const/auth';
import { ClerkAuth } from '@/libs/clerk-auth';

import { createLambdaContext } from './context';

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

vi.mock('@/envs/oidc', () => ({
  oidcEnv: {
    ENABLE_OIDC: false,
  },
}));

vi.mock('@/libs/clerk-auth', () => ({
  ClerkAuth: vi.fn(),
}));

describe('createLambdaContext account scope', () => {
  beforeEach(() => {
    authFlags.enableClerk = false;
    vi.clearAllMocks();
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

  it('authenticates the dev mock user without any header when ENABLE_MOCK_DEV_USER is set', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys');

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      rawAuthUserId: 'account-a',
      userId: 'account-a',
    });
  });

  it('uses the shared fallback identity when the mock user id is omitted', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys');

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      rawAuthUserId: 'DEV_USER',
      userId: 'DEV_USER',
    });
  });

  it('rejects the dev mock user outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys');

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      userId: undefined,
    });
  });

  it('authenticates the debug-api header with a matching bypass secret', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    vi.stubEnv('AUTH_DEV_BYPASS_SECRET', 'dev-secret');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        'lobe-auth-dev-backend-api': '1',
        'lobe-auth-dev-secret': 'dev-secret',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      userId: 'account-a',
    });
  });

  it('rejects the debug-api header when the bypass secret header is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    vi.stubEnv('AUTH_DEV_BYPASS_SECRET', 'dev-secret');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        'lobe-auth-dev-backend-api': '1',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      userId: undefined,
    });
  });

  it('rejects the debug-api header when AUTH_DEV_BYPASS_SECRET is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        'lobe-auth-dev-backend-api': '1',
        'lobe-auth-dev-secret': 'dev-secret',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      userId: undefined,
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
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:dev-account',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      accountScope: 'user:dev-account',
      clerkAuth: { userId: 'dev-account' },
      rawAuthUserId: 'dev-account',
      userId: 'prod-account',
    });
  });
});
