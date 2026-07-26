import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { initialModelListState } from '@/store/user/slices/modelList/initialState';
import type { GlobalServerConfig } from '@/types/serverConfig';
import { Plans } from '@/types/subscription';
import type { UserInitializationState } from '@/types/user';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const swrKeys: unknown[] = [];
const traceSWRKeys: unknown[] = [];

vi.mock('swr', () => ({
  default: (key: unknown) => {
    if (key) traceSWRKeys.push(key);

    return { data: undefined, mutate: vi.fn() };
  },
  mutate: vi.fn(),
}));

vi.mock('@/libs/swr', async () => {
  const React = await import('react');

  return {
    useOnlyFetchOnceSWR: (
      key: unknown,
      fetcher: () => Promise<UserInitializationState>,
      options: { onSuccess?: (data: UserInitializationState) => void },
    ) => {
      React.useEffect(() => {
        if (!key) return;

        swrKeys.push(key);
        void fetcher().then((data) => options.onSuccess?.(data));
      }, [key]);

      return { data: undefined };
    },
  };
});

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

describe('user state ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    swrKeys.length = 0;
    traceSWRKeys.length = 0;
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      isUserStateInit: false,
      preference: DEFAULT_PREFERENCE,
      user: { id: 'account-a' },
      userStateOwnerId: undefined,
      userStateScope: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the authenticated identity in the user-state cache key', async () => {
    vi.spyOn(userService, 'getUserState').mockResolvedValue({
      authUserId: 'account-a',
      isOnboard: true,
      preference: DEFAULT_PREFERENCE,
      settings: {},
      userId: 'account-a',
    });

    renderHook(() =>
      useUserStore.getState().useInitUserState(true, 'user:account-a', serverConfig),
    );

    await waitFor(() => {
      expect(swrKeys).toContainEqual(['initUserState', 'user:account-a']);
      expect(useUserStore.getState().userStateOwnerId).toBe('account-a');
    });
  });

  it('uses the authenticated identity in the telemetry consent cache key', () => {
    const { rerender } = renderHook(
      ({ scope }) => useUserStore.getState().useCheckTrace(true, scope),
      { initialProps: { scope: 'user:account-a' as string | undefined } },
    );

    rerender({ scope: 'user:account-b' });

    expect(traceSWRKeys).toEqual([
      ['checkTrace', 'user:account-a'],
      ['checkTrace', 'user:account-b'],
    ]);
  });

  it('does not read telemetry consent while the user identity is unresolved', () => {
    renderHook(() => useUserStore.getState().useCheckTrace(true, undefined));

    expect(traceSWRKeys).toEqual([]);
  });

  it('ignores an earlier account response after the identity changes', async () => {
    const accountAState = createDeferred<UserInitializationState>();
    const accountBState = createDeferred<UserInitializationState>();
    vi.spyOn(userService, 'getUserState')
      .mockReturnValueOnce(accountAState.promise)
      .mockReturnValueOnce(accountBState.promise);

    const { rerender } = renderHook(
      ({ scope }) => useUserStore.getState().useInitUserState(true, scope, serverConfig),
      { initialProps: { scope: 'user:account-a' } },
    );

    act(() => {
      useUserStore.setState({ authUserId: 'account-b', user: { id: 'account-b' } });
    });
    rerender({ scope: 'user:account-b' });

    accountAState.resolve({
      authUserId: 'account-a',
      isOnboard: true,
      preference: {
        ...DEFAULT_PREFERENCE,
        imageConfig: { model: 'account-a-model', provider: 'account-a-provider' },
      },
      settings: {},
      userId: 'account-a',
    });
    accountBState.resolve({
      authUserId: 'account-b',
      isOnboard: true,
      preference: {
        ...DEFAULT_PREFERENCE,
        imageConfig: { model: 'account-b-model', provider: 'account-b-provider' },
      },
      settings: {},
      userId: 'account-b',
    });

    await waitFor(() => {
      expect(useUserStore.getState().userStateOwnerId).toBe('account-b');
      expect(useUserStore.getState().preference.imageConfig).toEqual({
        model: 'account-b-model',
        provider: 'account-b-provider',
      });
    });

    expect(swrKeys).toEqual([
      ['initUserState', 'user:account-a'],
      ['initUserState', 'user:account-b'],
    ]);
  });

  it('ignores a response whose returned owner does not match the requested scope', async () => {
    const onSuccess = vi.fn();
    vi.spyOn(userService, 'getUserState').mockResolvedValue({
      authUserId: 'account-a',
      isOnboard: true,
      preference: {
        ...DEFAULT_PREFERENCE,
        imageConfig: { model: 'account-a-model', provider: 'account-a-provider' },
      },
      settings: { image: { defaultImageNum: 8 } },
      userId: 'account-a',
    });
    useUserStore.setState({
      authUserId: 'account-b',
      settings: { image: { defaultImageNum: 4 } },
      user: { id: 'account-b' },
    });

    renderHook(() =>
      useUserStore.getState().useInitUserState(true, 'user:account-b', serverConfig, { onSuccess }),
    );

    await waitFor(() => expect(userService.getUserState).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(useUserStore.getState().isUserStateInit).toBe(false);
    expect(useUserStore.getState().preference).toEqual(DEFAULT_PREFERENCE);
    expect(useUserStore.getState().settings).toEqual({});
    expect(useUserStore.getState().userStateOwnerId).toBeUndefined();
  });

  it('accepts a mapped data owner when the raw auth identity matches the scope', async () => {
    vi.spyOn(userService, 'getUserState').mockResolvedValue({
      authUserId: 'clerk-raw-user',
      isOnboard: true,
      preference: DEFAULT_PREFERENCE,
      settings: {},
      userId: 'impersonated-data-owner',
    });
    useUserStore.setState({
      authUserId: 'clerk-raw-user',
      user: { id: 'clerk-raw-user' },
    });

    renderHook(() =>
      useUserStore.getState().useInitUserState(true, 'user:clerk-raw-user', serverConfig),
    );

    await waitFor(() => {
      expect(useUserStore.getState().isUserStateInit).toBe(true);
      expect(useUserStore.getState().userStateOwnerId).toBe('impersonated-data-owner');
      expect(useUserStore.getState().userStateScope).toBe('user:clerk-raw-user');
    });
  });

  it('clears all common account state while auth identity is unresolved', async () => {
    useUserStore.setState({
      defaultModelProviderList: [
        {
          id: 'account-a-provider',
          models: [{ displayName: 'Account A Model', id: 'account-a-model' }],
          name: 'Account A Provider',
        },
      ],
      editingCustomCardModel: { id: 'account-a-model', provider: 'account-a-provider' },
      isOnboard: true,
      isShowPWAGuide: true,
      isUserCanEnableTrace: true,
      isUserHasConversation: true,
      isUserStateInit: true,
      modelProviderList: [
        {
          id: 'account-a-provider',
          models: [{ displayName: 'Account A Model', id: 'account-a-model' }],
          name: 'Account A Provider',
        },
      ],
      preference: { ...DEFAULT_PREFERENCE, imageConfig: { model: 'account-a-model' } },
      serverLanguageModel: {
        accountAProvider: {
          enabled: true,
          enabledModels: ['account-a-model'],
        },
      },
      settings: { image: { defaultImageNum: 8 } },
      subscriptionPlan: Plans.Premium,
      userStateOwnerId: 'account-a',
      userStateScope: 'user:account-a',
    });

    renderHook(() => useUserStore.getState().useInitUserState(true, undefined, serverConfig));

    await waitFor(() => {
      const userState = useUserStore.getState();
      expect(userState.isOnboard).toBe(false);
      expect(userState.isShowPWAGuide).toBe(false);
      expect(userState.isUserCanEnableTrace).toBe(false);
      expect(userState.isUserHasConversation).toBe(false);
      expect(userState.isUserStateInit).toBe(false);
      expect(userState.defaultModelProviderList).toEqual(
        initialModelListState.defaultModelProviderList,
      );
      expect(userState.editingCustomCardModel).toBeUndefined();
      expect(userState.modelProviderList).toEqual(initialModelListState.modelProviderList);
      expect(userState.preference).toEqual(DEFAULT_PREFERENCE);
      expect(userState.serverLanguageModel).toBeUndefined();
      expect(userState.settings).toEqual({});
      expect(userState.subscriptionPlan).toBeUndefined();
      expect(userState.user).toBeUndefined();
      expect(userState.userStateOwnerId).toBeUndefined();
      expect(userState.userStateScope).toBeUndefined();
    });
  });
});
