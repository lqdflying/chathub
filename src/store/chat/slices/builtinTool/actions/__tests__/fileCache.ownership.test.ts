import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

const swrKeys: unknown[] = [];

vi.mock('@/libs/swr', async () => {
  const React = await import('react');

  return {
    useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
      const serializedKey = JSON.stringify(key);

      React.useEffect(() => {
        if (!key) return;

        swrKeys.push(key);
        void fetcher();
      }, [serializedKey]);

      return { data: undefined };
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

describe('generated file cache ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    swrKeys.length = 0;
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'account-a' },
    });
    useChatStore.setState({
      codeInterpreterImageMap: {},
      conversationClearGeneration: 0,
      dalleImageMap: {},
    });
  });

  it('does not repopulate the interpreter cache after an A-to-B-to-A reset', async () => {
    const fileResponse = createDeferred<{ filename: string; id: string; url: string }>();
    vi.spyOn(fileService, 'getFile').mockReturnValue(fileResponse.promise as never);

    renderHook(() =>
      useChatStore.getState().useFetchInterpreterFileItem('interpreter-file-id'),
    );

    await waitFor(() => {
      expect(fileService.getFile).toHaveBeenCalledWith('interpreter-file-id');
    });

    act(() => {
      useUserStore.setState({ authUserId: 'account-b', user: { id: 'account-b' } });
      useChatStore.setState((state) => ({
        codeInterpreterImageMap: {},
        conversationClearGeneration: state.conversationClearGeneration + 1,
      }));
      useUserStore.setState({ authUserId: 'account-a', user: { id: 'account-a' } });
    });

    fileResponse.resolve({
      filename: 'account-a-output.png',
      id: 'interpreter-file-id',
      url: 'https://example.com/account-a-output.png',
    });
    await act(async () => {
      await fileResponse.promise;
      await Promise.resolve();
    });

    expect(swrKeys).toContainEqual([
      'FetchCodeInterpreterFileItem',
      'user:account-a',
      'interpreter-file-id',
    ]);
    expect(useChatStore.getState().codeInterpreterImageMap).toEqual({});
  });

  it('does not repopulate the DALL-E cache after an A-to-B-to-A reset', async () => {
    const fileResponse = createDeferred<{ filename: string; id: string; url: string }>();
    vi.spyOn(fileService, 'getFile').mockReturnValue(fileResponse.promise as never);

    renderHook(() => useChatStore.getState().useFetchDalleImageItem('dalle-file-id'));

    await waitFor(() => {
      expect(fileService.getFile).toHaveBeenCalledWith('dalle-file-id');
    });

    act(() => {
      useUserStore.setState({ authUserId: 'account-b', user: { id: 'account-b' } });
      useChatStore.setState((state) => ({
        conversationClearGeneration: state.conversationClearGeneration + 1,
        dalleImageMap: {},
      }));
      useUserStore.setState({ authUserId: 'account-a', user: { id: 'account-a' } });
    });

    fileResponse.resolve({
      filename: 'account-a-image.png',
      id: 'dalle-file-id',
      url: 'https://example.com/account-a-image.png',
    });
    await act(async () => {
      await fileResponse.promise;
      await Promise.resolve();
    });

    expect(swrKeys).toContainEqual([
      'FetchImageItem',
      'user:account-a',
      'dalle-file-id',
    ]);
    expect(useChatStore.getState().dalleImageMap).toEqual({});
  });
});
