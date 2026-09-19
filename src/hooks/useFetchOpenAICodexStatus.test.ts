import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryState = vi.hoisted(() => ({
  data: undefined as { connected?: boolean; email?: string } | undefined,
  enabled: false,
  input: undefined as { accountScope?: string } | undefined,
}));

const aiInfraState = vi.hoisted(() => ({
  connected: false,
  updateOpenAICodexConnected: vi.fn((connected: boolean) => {
    aiInfraState.connected = connected;
  }),
}));

const userState = vi.hoisted(() => ({
  hasOwnerMismatch: false,
  isLogin: true,
  isUserStateInit: true,
  preferenceOwner: 'user:account-a',
  userStateScope: 'user:account-a' as string | undefined,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    openaiCodex: {
      status: {
        useQuery: (input: { accountScope?: string }, options?: { enabled?: boolean }) => {
          queryState.input = input;
          queryState.enabled = !!options?.enabled;
          return {
            data: options?.enabled ? queryState.data : undefined,
          };
        },
      },
    },
  },
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: typeof aiInfraState) => unknown) => selector(aiInfraState),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    currentUserScope: (state: typeof userState) => state.preferenceOwner,
    hasActiveUserStateOwnerMismatch: (state: typeof userState) => state.hasOwnerMismatch,
    isLogin: (state: typeof userState) => state.isLogin,
  },
}));

import { publishAccountScopeInvalidation } from '@/store/accountScopeInvalidation';

import { useFetchOpenAICodexStatus } from './useFetchOpenAICodexStatus';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient() }, children);

describe('useFetchOpenAICodexStatus', () => {
  beforeEach(() => {
    queryState.data = { connected: true, email: 'a@example.com' };
    queryState.enabled = false;
    queryState.input = undefined;
    aiInfraState.connected = false;
    aiInfraState.updateOpenAICodexConnected.mockClear();
    userState.hasOwnerMismatch = false;
    userState.isLogin = true;
    userState.isUserStateInit = true;
    userState.preferenceOwner = 'user:account-a';
    userState.userStateScope = 'user:account-a';
  });

  it('scopes the status query to the current account and ignores a later switch', () => {
    const { rerender } = renderHook(() => useFetchOpenAICodexStatus(), { wrapper });

    expect(queryState.input).toEqual({ accountScope: 'user:account-a' });
    expect(queryState.enabled).toBe(true);
    expect(aiInfraState.updateOpenAICodexConnected).toHaveBeenCalledWith(true);

    userState.preferenceOwner = 'user:account-b';
    userState.userStateScope = 'user:account-b';
    queryState.data = { connected: false, email: 'b@example.com' };
    rerender();

    expect(queryState.input).toEqual({ accountScope: 'user:account-b' });
    expect(aiInfraState.updateOpenAICodexConnected).toHaveBeenLastCalledWith(false);
  });

  it('clears the routing flag when the account scope is invalidated', () => {
    renderHook(() => useFetchOpenAICodexStatus(), { wrapper });
    aiInfraState.updateOpenAICodexConnected.mockClear();

    act(() => {
      publishAccountScopeInvalidation({ generation: 2, scope: 'user:account-b' });
    });

    expect(aiInfraState.updateOpenAICodexConnected).toHaveBeenCalledWith(false);
  });
});
