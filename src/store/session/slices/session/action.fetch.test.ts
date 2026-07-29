import { act, renderHook, waitFor } from '@testing-library/react';
import type { SWRConfiguration } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/store/session';
import { createSessionListBaseKey } from '@/store/session/sessionListKey';
import { useUserStore } from '@/store/user';
import type { ChatSessionList } from '@/types/session';

const { mutateAccountSWRByPredicate, useClientDataSWR } = vi.hoisted(() => ({
  mutateAccountSWRByPredicate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWRByPredicate,
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
  }, 15_000);

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
  }, 15_000);

  it('starts and accepts a replacement fetch after the session generation changes', async () => {
    renderHook(() => useSessionStore.getState().useFetchSessions(true, true));

    expect(useClientDataSWR.mock.calls[0][0]).toEqual(
      createSessionListBaseKey('user:account-a', 0, 0),
    );

    act(() => {
      useSessionStore.setState({
        isSessionsFirstFetchFinished: false,
        scopeGeneration: 1,
        sessionGroups: [],
        sessions: [],
      });
    });

    await waitFor(() => {
      expect(useClientDataSWR).toHaveBeenCalledTimes(2);
    });

    const replacementCall = useClientDataSWR.mock.calls.at(-1);
    expect(replacementCall?.[0]).toEqual(createSessionListBaseKey('user:account-a', 0, 1));

    const replacementConfiguration = replacementCall?.[2] as SWRConfiguration<ChatSessionList>;
    await act(async () => {
      await replacementConfiguration.onSuccess?.(
        {
          sessionGroups: [],
          sessions: [],
        },
        'fetch-sessions',
        replacementConfiguration,
      );
    });

    expect(useSessionStore.getState().isSessionsFirstFetchFinished).toBe(true);
  });

  it('imperatively refreshes the epoch-aware session-list key', async () => {
    await act(async () => {
      await useSessionStore.getState().refreshSessions();
    });

    expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
    const [requestedScope, predicate] = mutateAccountSWRByPredicate.mock.calls[0];
    expect(requestedScope).toBe('user:account-a');

    const activeSessionListKey = [
      ...createSessionListBaseKey('user:account-a', 0, 0),
      ['account-cache-epoch', 0],
    ];
    expect(predicate(activeSessionListKey)).toBe(true);
    expect(predicate(['fetchSessions', 'user:account-a', ['account-cache-epoch', 0]])).toBe(false);
    expect(
      predicate([...createSessionListBaseKey('user:account-b', 0, 0), ['account-cache-epoch', 0]]),
    ).toBe(false);
    expect(predicate(['searchSessions', 'user:account-a', 0, 0])).toBe(false);
  });
});
