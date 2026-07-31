import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { S3 } from '@/server/modules/S3';

import { uploadRouter } from '../upload';

const { createPreSignedUrl } = vi.hoisted(() => ({
  createPreSignedUrl: vi.fn(),
}));

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

vi.mock('@/utils/uuid', () => ({
  nanoid: () => 'server-id',
}));

vi.mock('@/server/modules/S3', () => ({
  S3: vi.fn(() => ({ createPreSignedUrl })),
}));

describe('uploadRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(3_600_000);
    createPreSignedUrl.mockResolvedValue('https://storage.example.com/presigned');
  });

  it('signs only the server-generated current-user target', async () => {
    const caller = createCallerFactory(uploadRouter)({ userId: 'account-a' } as never);

    const result = await caller.createS3PreSignedUrl({ filename: 'photo.png', purpose: 'file' });

    expect(result.metadata.path).toMatch(/^files\/[a-f\d]{64}\/1\/server-id\.png$/);
    expect(createPreSignedUrl).toHaveBeenCalledWith(result.metadata.path);
    expect(S3).toHaveBeenCalledOnce();
  });

  it('does not accept the legacy caller-selected pathname payload', async () => {
    const caller = createCallerFactory(uploadRouter)({ userId: 'account-a' } as never);

    await expect(
      caller.createS3PreSignedUrl({ pathname: 'files/victim/file.png' } as never),
    ).rejects.toThrow();
    expect(createPreSignedUrl).not.toHaveBeenCalled();
  });
});
