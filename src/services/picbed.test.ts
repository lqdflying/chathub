import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      picbedService.uploadImage(file, 'user:account-a', new AbortController().signal),
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
      picbedService.uploadImage(file, 'user:account-a', new AbortController().signal),
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

    await picbedService.uploadImage(file, 'user:account-a', abortController.signal);

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
});
