import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { PicbedModel } from '@/database/models/picbed';
import { PICBED_VIDEO_SIZE_LIMIT } from '@/helpers/picbedMedia';
import { createUploadTarget } from '@/server/services/file/uploadTarget';

import { picbedRouter } from '../picbed';

const { getFullFileUrl } = vi.hoisted(() => ({
  getFullFileUrl: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/picbed');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ getFullFileUrl })),
}));

describe('picbedRouter', () => {
  const create = vi.fn();
  const query = vi.fn();
  const createInput = (storageOwner = 'account-a') => ({
    fileType: 'image/png',
    name: 'image.png',
    requestedScope: 'user:account-a',
    size: 5,
    url: createUploadTarget({ filename: 'image.png', purpose: 'file', userId: storageOwner }).path,
  });
  const input = createInput();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(PicbedModel).mockImplementation(() => ({ create, query }) as never);
    getFullFileUrl.mockResolvedValue('https://storage.example.com/media');
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
    const mappedInput = createInput('mapped-owner');
    create.mockResolvedValue({
      ...mappedInput,
      createdAt: new Date(),
      id: 'image-id',
      userId: 'mapped-owner',
    });
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'mapped-owner',
    } as never);

    await caller.create(mappedInput);

    expect(create).toHaveBeenCalledWith({
      fileType: mappedInput.fileType,
      name: mappedInput.name,
      size: mappedInput.size,
      url: mappedInput.url,
    });
  });

  it.each([
    ['another user key', () => createInput('account-b').url],
    ['a full storage URL', () => 'https://storage.example.com/files/account-a/image.png'],
  ] as const)('rejects %s before persistence or URL signing', async (_caseName, getUrl) => {
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.create({ ...input, url: getUrl() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Picbed upload key does not belong to the authenticated user',
    });
    expect(create).not.toHaveBeenCalled();
    expect(getFullFileUrl).not.toHaveBeenCalled();
  });

  it('accepts video metadata at the 20 MiB boundary', async () => {
    const videoInput = {
      ...input,
      fileType: 'video/mp4',
      name: 'video.mp4',
      size: PICBED_VIDEO_SIZE_LIMIT,
      url: createUploadTarget({ filename: 'video.mp4', purpose: 'file', userId: 'account-a' }).path,
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

  it('continues to resolve legacy unscoped records when listing media', async () => {
    const legacyRecord = {
      ...input,
      createdAt: new Date(),
      id: 'legacy-image',
      url: 'files/legacy-hour/legacy-image.png',
      userId: 'account-a',
    };
    query.mockResolvedValue([legacyRecord]);
    getFullFileUrl.mockResolvedValue('https://storage.example.com/legacy-image.png');
    const caller = picbedRouter.createCaller({
      accountScope: 'user:account-a',
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(caller.list()).resolves.toEqual([
      { ...legacyRecord, url: 'https://storage.example.com/legacy-image.png' },
    ]);
    expect(getFullFileUrl).toHaveBeenCalledWith(legacyRecord.url);
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
