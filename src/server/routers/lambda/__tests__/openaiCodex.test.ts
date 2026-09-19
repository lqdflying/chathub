import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER } from '@/const/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { createLambdaClient } from '@/libs/trpc/client/lambda';
import { router } from '@/libs/trpc/lambda';

import { openaiCodexRouter } from '../openaiCodex';

const oauth = vi.hoisted(() => ({
  getStatus: vi.fn(),
  logout: vi.fn(),
  pollDeviceLogin: vi.fn(),
  startDeviceLogin: vi.fn(),
}));

vi.mock('@/components/Error/loginRequiredNotification', () => ({
  loginRequired: { redirect: vi.fn() },
}));
vi.mock('@/components/Error/fetchErrorNotification', () => ({
  fetchErrorNotification: { error: vi.fn() },
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

  const createCodexTransportClient = (
    scope: string,
    capturedScopes?: Array<string | null>,
    stripAccountScope = false,
  ) => {
    const routes = router({ openaiCodex: openaiCodexRouter });
    return createLambdaClient({
      assertAccountOwnership: () => ({
        ownershipInvalidationGeneration: 0,
        scope,
      }),
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        if (stripAccountScope) headers.delete(CHATHUB_ACCOUNT_SCOPE_HEADER);
        const request = new Request(new URL(String(url), 'https://chathub.example'), {
          ...init,
          headers,
        });
        capturedScopes?.push(request.headers.get(CHATHUB_ACCOUNT_SCOPE_HEADER));
        return fetchRequestHandler({
          createContext: async () => ({
            accountScope: request.headers.get(CHATHUB_ACCOUNT_SCOPE_HEADER),
            rawAuthUserId: 'account-a',
            userId: 'account-a',
          }),
          endpoint: '/trpc/lambda',
          req: request,
          router: routes,
        });
      },
      getAuthHeaders: async () => ({}),
    });
  };

  it('sends the account-scope header for every Codex RPC through the real router', async () => {
    oauth.startDeviceLogin.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      handoffId: 'handoff-1',
      userCode: 'ABCD-1234',
      verificationUrl: 'https://auth.openai.com/codex/device',
    });
    oauth.pollDeviceLogin.mockResolvedValue({ status: 'pending' });
    oauth.logout.mockResolvedValue(undefined);

    const scopes: Array<string | null> = [];
    const client = createCodexTransportClient('user:account-a', scopes);
    const notify = { context: { showNotification: false } };
    const input = { accountScope: 'user:account-a' };

    await expect(client.openaiCodex.status.query(input, notify)).resolves.toEqual({
      connected: true,
      email: 'plus@example.com',
    });
    await expect(client.openaiCodex.startDeviceLogin.mutate(input, notify)).resolves.toMatchObject({
      handoffId: 'handoff-1',
    });
    await expect(
      client.openaiCodex.pollDeviceLogin.mutate({ ...input, handoffId: 'handoff-1' }, notify),
    ).resolves.toEqual({ status: 'pending' });
    await expect(client.openaiCodex.logout.mutate(input, notify)).resolves.toEqual({
      success: true,
    });

    expect(scopes).toEqual([
      'user:account-a',
      'user:account-a',
      'user:account-a',
      'user:account-a',
    ]);
    expect(oauth.getStatus).toHaveBeenCalledWith('account-a');
    expect(oauth.startDeviceLogin).toHaveBeenCalledWith('account-a');
    expect(oauth.pollDeviceLogin).toHaveBeenCalledWith('account-a', 'handoff-1');
    expect(oauth.logout).toHaveBeenCalledWith('account-a');
  });

  it('rejects a missing account-scope header before any token operation', async () => {
    const scopes: Array<string | null> = [];
    const client = createCodexTransportClient('user:account-a', scopes, true);

    await expect(
      client.openaiCodex.status.query(
        { accountScope: 'user:account-a' },
        { context: { showNotification: false } },
      ),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN', httpStatus: 403 },
    });
    expect(scopes).toEqual([null]);
    expect(oauth.getStatus).not.toHaveBeenCalled();
  });

  it('rejects a mismatched verified-account header before any token operation', async () => {
    const routes = router({ openaiCodex: openaiCodexRouter });
    const client = createLambdaClient({
      assertAccountOwnership: () => ({
        ownershipInvalidationGeneration: 0,
        scope: 'user:account-b',
      }),
      fetch: async (url, init) => {
        const request = new Request(new URL(String(url), 'https://chathub.example'), init);
        return fetchRequestHandler({
          createContext: async () => ({
            accountScope: request.headers.get(CHATHUB_ACCOUNT_SCOPE_HEADER),
            rawAuthUserId: 'account-a',
            userId: 'account-a',
          }),
          endpoint: '/trpc/lambda',
          req: request,
          router: routes,
        });
      },
      getAuthHeaders: async () => ({}),
    });

    await expect(
      client.openaiCodex.status.query(
        { accountScope: 'user:account-a' },
        { context: { showNotification: false } },
      ),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN', httpStatus: 403 },
    });
    expect(oauth.getStatus).not.toHaveBeenCalled();
  });
});
