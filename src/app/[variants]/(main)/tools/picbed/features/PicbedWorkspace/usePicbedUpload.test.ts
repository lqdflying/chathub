import { act, renderHook, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PICBED_VIDEO_SIZE_LIMIT } from '@/helpers/picbedMedia';
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

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

describe('usePicbedUpload', () => {
  const error = vi.fn();
  const success = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
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
    vi.spyOn(picbedService, 'uploadMedia').mockImplementation(async (file) => {
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
    expect(picbedService.uploadMedia).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
  });

  it('resets the global drag state when the Dragger consumes a drop', () => {
    const { result } = renderHook(() => usePicbedUpload('user:account-a'));

    act(() => {
      window.dispatchEvent(new Event('dragenter'));
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.stopDragging();
    });
    expect(result.current.isDragging).toBe(false);
  });

  it('aborts an active upload when the scope remounts', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(picbedService, 'uploadMedia').mockImplementation(
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

  it('uploads a video from a clipboard paste and copies its URL', async () => {
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    vi.spyOn(picbedService, 'uploadMedia').mockResolvedValue({
      fileType: video.type,
      id: 'video-id',
      name: video.name,
      size: video.size,
      url: 'https://example.com/clip.mp4',
    });
    renderHook(() => usePicbedUpload('user:account-a'));
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          {
            getAsFile: () => video,
            kind: 'file',
            type: video.type,
          },
        ],
      },
    });

    act(() => {
      window.dispatchEvent(pasteEvent);
    });

    await waitFor(() => {
      expect(picbedService.uploadMedia).toHaveBeenCalledWith(
        video,
        'user:account-a',
        expect.any(AbortSignal),
      );
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://example.com/clip.mp4');
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(success).toHaveBeenCalledWith('picbed.uploadSuccessCopied');
  });

  it('skips invalid media once per reason and continues a valid mixed batch', async () => {
    const unsupportedA = new File(['pdf'], 'first.pdf', { type: 'application/pdf' });
    const unsupportedB = new File(['text'], 'second.txt', { type: 'text/plain' });
    const oversizedA = new File(['video'], 'first.mp4', { type: 'video/mp4' });
    const oversizedB = new File(['video'], 'second.webm', { type: 'video/webm' });
    Object.defineProperty(oversizedA, 'size', { value: PICBED_VIDEO_SIZE_LIMIT + 1 });
    Object.defineProperty(oversizedB, 'size', { value: PICBED_VIDEO_SIZE_LIMIT + 2 });
    const image = new File(['image'], 'valid.png', { type: 'image/png' });
    vi.spyOn(picbedService, 'uploadMedia').mockResolvedValue({
      fileType: image.type,
      id: 'image-id',
      name: image.name,
      size: image.size,
      url: 'https://example.com/valid.png',
    });
    const { result } = renderHook(() => usePicbedUpload('user:account-a'));

    let uploadResult;
    await act(async () => {
      uploadResult = await result.current.uploadFiles([
        unsupportedA,
        unsupportedB,
        oversizedA,
        oversizedB,
        image,
      ]);
    });

    expect(uploadResult).toHaveLength(1);
    expect(picbedService.uploadMedia).toHaveBeenCalledTimes(1);
    expect(picbedService.uploadMedia).toHaveBeenCalledWith(
      image,
      'user:account-a',
      expect.any(AbortSignal),
    );
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('picbed.unsupportedType');
    expect(error).toHaveBeenCalledWith('picbed.videoSizeExceeded');
    expect(writeText).toHaveBeenCalledWith('https://example.com/valid.png');
  });
});
