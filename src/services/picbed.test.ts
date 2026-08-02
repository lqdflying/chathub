import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PICBED_VIDEO_SIZE_LIMIT } from '@/helpers/picbedMedia';
import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';

import { picbedService } from './picbed';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    picbed: {
      create: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('PicbedService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('stops before storage upload when authenticated ownership is not verified', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const uploadFileToS3Spy = vi.spyOn(uploadService, 'uploadFileToS3');
    useUserStore.setState({
      isUserStateInit: false,
      userStateOwnerId: undefined,
      userStateScope: undefined,
    });

    await expect(
      picbedService.uploadMedia(file, 'user:account-a', new AbortController().signal),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(uploadFileToS3Spy).not.toHaveBeenCalled();
    expect(lambdaClient.picbed.create.mutate).not.toHaveBeenCalled();
  });

  it('stops before record creation when the account changes during storage upload', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    vi.spyOn(uploadService, 'uploadFileToS3').mockImplementation(async (_file, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      useUserStore.setState({
        authUserId: 'account-b',
        user: { id: 'account-b' },
      });

      return {
        data: {
          date: '1',
          dirname: 'picbed/1',
          filename: 'image.png',
          path: 'picbed/1/image.png',
        },
        success: true,
      };
    });

    await expect(
      picbedService.uploadMedia(file, 'user:account-a', new AbortController().signal),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(lambdaClient.picbed.create.mutate).not.toHaveBeenCalled();
  });

  it('passes the owner and abort signal through record creation', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const abortController = new AbortController();
    vi.spyOn(uploadService, 'uploadFileToS3').mockResolvedValue({
      data: {
        date: '1',
        dirname: 'picbed/1',
        filename: 'image.png',
        path: 'picbed/1/image.png',
      },
      success: true,
    });
    vi.mocked(lambdaClient.picbed.create.mutate).mockResolvedValue({
      createdAt: new Date(),
      fileType: file.type,
      id: 'image-id',
      name: file.name,
      size: file.size,
      url: 'https://example.com/image.png',
      userId: 'account-a',
    });

    await picbedService.uploadMedia(file, 'user:account-a', abortController.signal);

    expect(uploadService.uploadFileToS3).toHaveBeenCalledWith(file, {
      signal: abortController.signal,
    });

    expect(lambdaClient.picbed.create.mutate).toHaveBeenCalledWith(
      {
        fileType: file.type,
        name: file.name,
        requestedScope: 'user:account-a',
        size: file.size,
        url: 'picbed/1/image.png',
      },
      { signal: abortController.signal },
    );
  });

  it('rejects unsupported files before storage upload', async () => {
    const file = new File(['document'], 'document.pdf', { type: 'application/pdf' });
    const uploadFileToS3Spy = vi.spyOn(uploadService, 'uploadFileToS3');

    await expect(picbedService.uploadMedia(file, 'user:account-a')).rejects.toThrow(
      'Invalid Picbed media: unsupportedType',
    );

    expect(uploadFileToS3Spy).not.toHaveBeenCalled();
    expect(lambdaClient.picbed.create.mutate).not.toHaveBeenCalled();
  });

  it('accepts a video at 20 MiB and rejects a larger video before storage upload', async () => {
    const boundaryVideo = new File(['video'], 'boundary.mp4', { type: 'video/mp4' });
    Object.defineProperty(boundaryVideo, 'size', { value: PICBED_VIDEO_SIZE_LIMIT });
    const oversizedVideo = new File(['video'], 'oversized.mp4', { type: 'video/mp4' });
    Object.defineProperty(oversizedVideo, 'size', { value: PICBED_VIDEO_SIZE_LIMIT + 1 });
    const uploadFileToS3Spy = vi.spyOn(uploadService, 'uploadFileToS3').mockResolvedValue({
      data: {
        date: '1',
        dirname: 'picbed/1',
        filename: 'boundary.mp4',
        path: 'picbed/1/boundary.mp4',
      },
      success: true,
    });
    vi.mocked(lambdaClient.picbed.create.mutate).mockResolvedValue({
      createdAt: new Date(),
      fileType: boundaryVideo.type,
      id: 'video-id',
      name: boundaryVideo.name,
      size: boundaryVideo.size,
      url: 'https://example.com/boundary.mp4',
      userId: 'account-a',
    });

    await expect(picbedService.uploadMedia(boundaryVideo, 'user:account-a')).resolves.toMatchObject(
      {
        fileType: 'video/mp4',
        id: 'video-id',
      },
    );
    await expect(picbedService.uploadMedia(oversizedVideo, 'user:account-a')).rejects.toThrow(
      'Invalid Picbed media: videoSizeExceeded',
    );

    expect(uploadFileToS3Spy).toHaveBeenCalledTimes(1);
  });
});
