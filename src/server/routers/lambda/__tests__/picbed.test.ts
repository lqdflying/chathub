import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { PicbedModel } from '@/database/models/picbed';
import { PICBED_VIDEO_SIZE_LIMIT } from '@/helpers/picbedMedia';

import { picbedRouter } from '../picbed';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/picbed');
vi.mock('@/server/services/file');

describe('picbedRouter', () => {
  const create = vi.fn();
  const input = {
    fileType: 'image/png',
    name: 'image.png',
    requestedScope: 'user:account-a',
    size: 5,
    url: 'picbed/1/image.png',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(PicbedModel).mockImplementation(() => ({ create }) as never);
  });

  it('rejects a create request owned by a different authenticated account', async () => {
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-b',
      clerkAuth: { userId: 'account-b' },
      userId: 'account-b',
    } as never);

    await expect(caller.create(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Picbed upload account changed',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts the raw authenticated owner when the database owner is mapped', async () => {
    create.mockResolvedValue({
      ...input,
      createdAt: new Date(),
      id: 'image-id',
      userId: 'mapped-owner',
    });
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'mapped-owner',
    } as never);

    await caller.create(input);

    expect(create).toHaveBeenCalledWith({
      fileType: input.fileType,
      name: input.name,
      size: input.size,
      url: input.url,
    });
  });

  it('accepts video metadata at the 20 MiB boundary', async () => {
    const videoInput = {
      ...input,
      fileType: 'video/mp4',
      name: 'video.mp4',
      size: PICBED_VIDEO_SIZE_LIMIT,
      url: 'picbed/1/video.mp4',
    };
    create.mockResolvedValue({
      ...videoInput,
      createdAt: new Date(),
      id: 'video-id',
      userId: 'account-a',
    });
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await caller.create(videoInput);

    expect(create).toHaveBeenCalledWith({
      fileType: videoInput.fileType,
      name: videoInput.name,
      size: videoInput.size,
      url: videoInput.url,
    });
  });

  it.each([
    ['unsupported type', { fileType: 'application/pdf' }],
    ['oversized video', { fileType: 'video/mp4', size: PICBED_VIDEO_SIZE_LIMIT + 1 }],
  ])('rejects %s metadata before persistence', async (_caseName, override) => {
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.create({ ...input, ...override })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['guest', 'guest'],
    ['foreign', 'user:account-b'],
  ])('rejects a %s account scope before database access', async (_caseName, accountScope) => {
    const caller = picbedRouter.createCaller({
      accountScope,
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Account scope does not match the authenticated user',
    });
    expect(getServerDB).not.toHaveBeenCalled();
  });
});
