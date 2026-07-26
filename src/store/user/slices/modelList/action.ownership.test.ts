import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { modelsService } from '@/services/models';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));
vi.mock('@/services/user', () => ({
  userService: {
    updateUserSettings: vi.fn(),
  },
}));

const swrKeys: unknown[] = [];

vi.mock('swr', async () => {
  const React = await import('react');

  return {
    default: (
      key: unknown,
      fetcher: (key: unknown) => Promise<unknown>,
      options: {
        onSuccess?: (data: unknown) => void;
        revalidateOnMount?: boolean;
      },
    ) => {
      const serializedKey = JSON.stringify(key);

      React.useEffect(() => {
        if (!key || !options.revalidateOnMount) return;

        swrKeys.push(key);
        void fetcher(key).then((data) => options.onSuccess?.(data));
      }, [serializedKey, options.revalidateOnMount]);

      return { data: undefined, isValidating: false, mutate: vi.fn() };
    },
  };
});

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('provider model-list ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    swrKeys.length = 0;
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      settings: {},
      user: { id: 'account-a' },
    });
  });

  it('does not persist an earlier account response after the identity changes', async () => {
    const accountAModels = createDeferred<{ id: string }[]>();
    vi.spyOn(modelsService, 'getModels').mockReturnValue(accountAModels.promise);

    const { rerender } = renderHook(
      ({ enabledAutoFetch, scope }) =>
        useUserStore
          .getState()
          .useFetchProviderModelList('openai', enabledAutoFetch, scope),
      {
        initialProps: {
          enabledAutoFetch: true,
          scope: 'user:account-a',
        },
      },
    );

    await waitFor(() => {
      expect(modelsService.getModels).toHaveBeenCalledWith('openai');
    });

    act(() => {
      useUserStore.setState({
        authUserId: 'account-b',
        settings: { languageModel: { openai: { enabled: true } } },
        user: { id: 'account-b' },
      });
    });
    rerender({ enabledAutoFetch: false, scope: 'user:account-b' });

    accountAModels.resolve([{ id: 'account-a-model' }]);
    await act(async () => {
      await accountAModels.promise;
      await Promise.resolve();
    });

    expect(swrKeys).toContainEqual([
      'fetch-provider-model-list',
      'user:account-a',
      'openai',
      true,
    ]);
    expect(userService.updateUserSettings).not.toHaveBeenCalled();
    expect(useUserStore.getState().settings).toEqual({
      languageModel: { openai: { enabled: true } },
    });
  });
});
