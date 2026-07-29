import { act, renderHook } from '@testing-library/react';
import type { SWRConfiguration } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import type { ChatSessionList } from '@/types/session';

const { useClientDataSWR } = vi.hoisted(() => ({
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  useClientDataSWR,
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const startGroupSynchronization = () => {
  renderHook(() => useSessionStore.getState().useFetchSessions(true, true));

  const swrConfiguration = useClientDataSWR.mock.calls[0][2] as SWRConfiguration<ChatSessionList>;
  const successPromise = swrConfiguration.onSuccess?.(
    {
      sessionGroups: [],
      sessions: [
        {
          createdAt: new Date(),
          id: 'stale-group',
          meta: { title: 'Stale Group' },
          type: 'group',
          updatedAt: new Date(),
        },
      ],
    } as ChatSessionList,
    'fetch-sessions',
    swrConfiguration,
  );

  return successPromise;
};

const expectStaleSynchronizationRejected = async (successPromise: void | Promise<void>) => {
  await act(async () => {
    await successPromise;
  });

  const { useChatGroupStore } = await import('@/store/chatGroup/store');
  expect(useSessionStore.getState()).toMatchObject({
    isSessionsFirstFetchFinished: false,
    sessionGroups: [],
    sessions: [],
  });
  expect(useChatGroupStore.getState().groupMap).not.toHaveProperty('stale-group');
};

describe('useFetchSessions ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      ownershipInvalidationGeneration: 0,
      user: { id: 'account-a' },
      userStateInitializationFailure: undefined,
    });
    useSessionStore.setState({
      isSessionsFirstFetchFinished: false,
      scopeGeneration: 0,
      sessionGroups: [],
      sessions: [],
    });
    useClientDataSWR.mockReturnValue({ data: undefined });
  });

  it('rejects group synchronization after same-scope ownership invalidation', async () => {
    const successPromise = startGroupSynchronization();

    act(() => {
      useUserStore.setState({
        ownershipInvalidationGeneration: 1,
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      useSessionStore.setState({
        isSessionsFirstFetchFinished: false,
        sessionGroups: [],
        sessions: [],
      });
    });

    await expectStaleSynchronizationRejected(successPromise);
  });

  it('rejects group synchronization after the session store generation changes', async () => {
    const successPromise = startGroupSynchronization();

    act(() => {
      useSessionStore.setState({
        isSessionsFirstFetchFinished: false,
        scopeGeneration: 1,
        sessionGroups: [],
        sessions: [],
      });
    });

    await expectStaleSynchronizationRejected(successPromise);
  });
});
