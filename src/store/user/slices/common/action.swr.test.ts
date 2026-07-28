import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { clearAccountCache } from '@/libs/swr/accountCache';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { initialState } from '@/store/user/initialState';
import type { GlobalServerConfig } from '@/types/serverConfig';
import type { UserInitializationState } from '@/types/user';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const serverConfig = {
  aiProvider: {},
  telemetry: {},
} as GlobalServerConfig;

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const createUserState = (): UserInitializationState => ({
  authUserId: 'account-a',
  isOnboard: true,
  preference: DEFAULT_PREFERENCE,
  settings: {},
  userId: 'account-a',
});

describe('user state SWR lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearAccountCache();
    useUserStore.setState(
      {
        ...initialState,
        authUserId: 'account-a',
        isLoaded: true,
        isSignedIn: true,
        user: { id: 'account-a' },
      },
      false,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearAccountCache();
  });

  it('starts a fresh request when the same account remounts after cache clearing', async () => {
    const detachedRequest = createDeferred<UserInitializationState>();
    const replacementRequest = createDeferred<UserInitializationState>();
    vi.spyOn(userService, 'getUserState')
      .mockReturnValueOnce(detachedRequest.promise)
      .mockReturnValueOnce(replacementRequest.promise);
    vi.spyOn(useUserStore.getState(), 'refreshDefaultModelProviderList').mockResolvedValue();

    const { rerender } = renderHook(
      ({ scope }) => useUserStore.getState().useInitUserState(Boolean(scope), scope, serverConfig),
      {
        initialProps: { scope: 'user:account-a' as string | undefined },
      },
    );

    await waitFor(() => expect(userService.getUserState).toHaveBeenCalledTimes(1));

    act(() => {
      useUserStore.setState({
        authUserId: undefined,
        isLoaded: false,
        isSignedIn: undefined,
        user: undefined,
      });
      rerender({ scope: undefined });
    });

    detachedRequest.resolve(createUserState());
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await clearAccountCache();

    act(() => {
      useUserStore.setState({
        authUserId: 'account-a',
        isLoaded: true,
        isSignedIn: true,
        user: { id: 'account-a' },
      });
      rerender({ scope: 'user:account-a' });
    });

    await waitFor(() => expect(userService.getUserState).toHaveBeenCalledTimes(2));
    expect(useUserStore.getState().isUserStateInit).toBe(false);

    replacementRequest.resolve(createUserState());

    await waitFor(() => {
      const userState = useUserStore.getState();
      expect(userState.isUserStateInit).toBe(true);
      expect(userState.userStateOwnerId).toBe('account-a');
      expect(userState.userStateScope).toBe('user:account-a');
    });
  });
});
