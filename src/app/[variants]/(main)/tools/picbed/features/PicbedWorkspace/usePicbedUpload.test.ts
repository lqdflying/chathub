import { act, renderHook } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { picbedService } from '@/services/picbed';
import { useUserStore } from '@/store/user';

import { usePicbedUpload } from './usePicbedUpload';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('antd', () => ({
  App: {
    useApp: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('usePicbedUpload', () => {
  const error = vi.fn();
  const success = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(App.useApp).mockReturnValue({
      message: { error, success },
    } as never);
    vi.stubGlobal('navigator', {
      clipboard: { writeText },
    });
    useUserStore.setState({
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      isUserStateInit: true,
      user: { id: 'account-a' },
      userStateOwnerId: 'account-a',
      userStateScope: 'user:account-a',
    });
  });

  it('aborts the remaining batch when the account changes', async () => {
    const firstFile = new File(['first'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' });
    vi.spyOn(picbedService, 'uploadImage').mockImplementation(async (file) => {
      useUserStore.setState({
        authUserId: 'account-b',
        user: { id: 'account-b' },
      });

      return {
        fileType: file.type,
        id: 'first-image',
        name: file.name,
        size: file.size,
        url: 'https://example.com/first.png',
      };
    });
    const { result } = renderHook(() => usePicbedUpload('user:account-a'));

    let uploadResult;
    await act(async () => {
      uploadResult = await result.current.uploadFiles([firstFile, secondFile]);
    });

    expect(uploadResult).toBeUndefined();
    expect(picbedService.uploadImage).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it('aborts an active upload when the scope remounts', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(picbedService, 'uploadImage').mockImplementation(
      async (_file, _requestedScope, signal) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
      },
    );
    const { result, rerender } = renderHook(
      ({ requestedScope }) => usePicbedUpload(requestedScope),
      { initialProps: { requestedScope: 'user:account-a' as string | undefined } },
    );

    let uploadPromise: Promise<unknown>;
    act(() => {
      uploadPromise = result.current.uploadFiles([file]);
    });
    rerender({ requestedScope: 'user:account-b' });

    await act(async () => {
      await uploadPromise;
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
