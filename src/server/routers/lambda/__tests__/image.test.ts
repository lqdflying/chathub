import { describe, expect, it, vi } from 'vitest';

import { enableAuth } from '@/const/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { deriveChatImageTaskId } from '@/helpers/chatImageTaskId';
import * as generationDebug from '@/libs/logger/generationDebug';
import { createCallerFactory } from '@/libs/trpc/lambda';
import type { LambdaContext } from '@/libs/trpc/lambda/context';
import { resolveAuthenticatedAccountScope } from '@/libs/trpc/lambda/middleware/verifiedAccountScope';
import { createAsyncCaller } from '@/server/routers/async/caller';
import {
  createImageInputSchema,
  validateNoUrlsInConfig,
} from '@/server/routers/lambda/image/schema';
import { FileService } from '@/server/services/file';
import { FileSource } from '@/types/files';

import { imageRouter } from '../image';

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    KEY_VAULTS_SECRET: 'test-secret',
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));

const { mockExistsByAssetKey } = vi.hoisted(() => ({ mockExistsByAssetKey: vi.fn() }));
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(() => ({ existsByAssetKey: mockExistsByAssetKey })),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://chat.example.com',
  },
}));

vi.mock('@/libs/logger/imageDebug', () => ({
  describeImageDebugError: vi.fn(),
  fingerprintImageDebugValue: vi.fn(() => ({ hash: 'test-hash' })),
  isImageDebugEnabled: vi.fn(() => false),
  logImageDebugSafe: vi.fn(),
  logImageDebugVerbose: vi.fn(),
  runWithImageDebugContext: vi.fn((callback: () => unknown) => callback()),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/server/routers/async/caller', () => ({
  createAsyncCaller: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(() => ({})),
}));

const validInput = {
  generationTopicId: 'topic-id',
  imageNum: 4,
  model: 'gpt-image-1',
  params: { prompt: 'Generate an image' },
  provider: 'openai',
};

const gptImage2CompatibleInput = {
  ...validInput,
  model: 'gpt-image-2',
  provider: 'openaicompatible',
};

describe('imageRouter', () => {
  it('normalizes app-proxy and storage references before dispatch', async () => {
    const appProxyReference =
      'https://chat.example.com/webapi/files/references/nested%20folder/single.png';
    const expiredMultipleReference =
      'https://storage.example.com/references/multiple.png?X-Amz-Signature=expired';
    const storagePathCollisionReference =
      'https://storage.example.com/webapi/files/references/collision.png';
    const protocolRelativeAppProxyReference =
      '//chat.example.com/webapi/files/references/protocol-relative.png';
    const inlineReference = 'data:image/png;base64,aW1hZ2U=';
    const freshSingleReference =
      'https://storage.example.com/references/nested%20folder/single.png?X-Amz-Signature=fresh';
    const freshMultipleReference =
      'https://storage.example.com/references/multiple.png?X-Amz-Signature=fresh';
    const freshCollisionReference =
      'https://storage.example.com/webapi/files/references/collision.png?X-Amz-Signature=fresh';
    const freshProtocolRelativeReference =
      'https://storage.example.com/references/protocol-relative.png?X-Amz-Signature=fresh';
    const batchValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'batch-id' }]),
    });
    const generationValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'generation-id' }]),
    });
    const asyncTaskValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'task-id' }]),
    });
    const transaction = {
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: batchValues })
        .mockReturnValueOnce({ values: generationValues })
        .mockReturnValueOnce({ values: asyncTaskValues }),
      select: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const serverDB = {
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const getKeyFromFullUrl = vi.fn((reference: string) => {
      if (reference === expiredMultipleReference) return 'references/multiple.png';
      if (reference === storagePathCollisionReference) {
        return 'webapi/files/references/collision.png';
      }
      return reference;
    });
    const getFullFileUrl = vi.fn(async (key: string) => {
      if (key === 'references/nested folder/single.png') return freshSingleReference;
      if (key === 'references/multiple.png') return freshMultipleReference;
      if (key === 'webapi/files/references/collision.png') return freshCollisionReference;
      if (key === 'references/protocol-relative.png') return freshProtocolRelativeReference;
      return key;
    });
    const dispatchCreateImage = vi.fn().mockResolvedValue({ success: true });

    const isKeyOwnedByUser = vi.fn().mockResolvedValue(true);
    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl, isKeyOwnedByUser }) as never,
    );
    vi.mocked(createAsyncCaller).mockResolvedValue({
      image: { createImage: dispatchCreateImage },
    } as never);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await caller.createImage({
      ...validInput,
      imageNum: 1,
      params: {
        imageReferenceFormatVersion: 999,
        imageUrl: appProxyReference,
        imageUrls: [
          expiredMultipleReference,
          storagePathCollisionReference,
          protocolRelativeAppProxyReference,
          inlineReference,
        ],
        prompt: 'Generate an image',
      },
    });

    expect(batchValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          imageReferenceFormatVersion: 1,
          imageUrl: 'references/nested folder/single.png',
          imageUrls: [
            'references/multiple.png',
            'webapi/files/references/collision.png',
            'references/protocol-relative.png',
            inlineReference,
          ],
          prompt: 'Generate an image',
        },
      }),
    );
    expect(getKeyFromFullUrl).not.toHaveBeenCalledWith(appProxyReference);
    expect(getKeyFromFullUrl).not.toHaveBeenCalledWith(protocolRelativeAppProxyReference);
    expect(getKeyFromFullUrl).toHaveBeenCalledWith(storagePathCollisionReference);
    expect(getFullFileUrl).toHaveBeenCalledWith('references/nested folder/single.png');
    expect(getFullFileUrl).toHaveBeenCalledWith('references/multiple.png');
    expect(getFullFileUrl).not.toHaveBeenCalledWith(inlineReference);
    expect(dispatchCreateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          imageUrl: freshSingleReference,
          imageUrls: [
            freshMultipleReference,
            freshCollisionReference,
            freshProtocolRelativeReference,
            inlineReference,
          ],
          prompt: 'Generate an image',
        },
      }),
    );
  });

  it('rejects foreign protocol-relative references before persistence', async () => {
    const serverDB = {
      transaction: vi.fn(),
    };
    const getFullFileUrl = vi.fn();
    const getKeyFromFullUrl = vi.fn((reference: string) => reference);
    const dispatchCreateImage = vi.fn();

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl }) as never,
    );
    vi.mocked(createAsyncCaller).mockResolvedValue({
      image: { createImage: dispatchCreateImage },
    } as never);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await expect(
      caller.createImage({
        ...validInput,
        imageNum: 1,
        params: {
          imageUrl: '//storage.example.com/references/image.png',
          prompt: 'Generate an image',
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Protocol-relative image references are not supported',
    });
    expect(serverDB.transaction).not.toHaveBeenCalled();
    expect(getFullFileUrl).not.toHaveBeenCalled();
    expect(getKeyFromFullUrl).not.toHaveBeenCalled();
    expect(dispatchCreateImage).not.toHaveBeenCalled();
  });

  it('preserves versioned storage-path collisions during regeneration', async () => {
    const collisionStoredReference = 'webapi/files/references/collision.png';
    const feedExpandedCollisionReference =
      'https://storage.example.com/webapi/files/references/collision.png';
    const freshCollisionReference =
      'https://storage.example.com/webapi/files/references/collision.png?X-Amz-Signature=fresh';
    const batchValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'replacement-batch-id' }]),
    });
    const generationValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'generation-id' }]),
    });
    const asyncTaskValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'task-id' }]),
    });
    const transaction = {
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: batchValues })
        .mockReturnValueOnce({ values: generationValues })
        .mockReturnValueOnce({ values: asyncTaskValues }),
      select: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const serverDB = {
      query: {
        generationBatches: {
          findFirst: vi.fn().mockResolvedValue({
            config: {
              imageReferenceFormatVersion: 1,
              imageUrl: collisionStoredReference,
            },
          }),
        },
      },
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const getKeyFromFullUrl = vi.fn((reference: string) => reference);
    const getFullFileUrl = vi.fn(async (key: string) => {
      if (key === collisionStoredReference) return freshCollisionReference;
      return key;
    });
    const dispatchCreateImage = vi.fn().mockResolvedValue({ success: true });

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl }) as never,
    );
    vi.mocked(createAsyncCaller).mockResolvedValue({
      image: { createImage: dispatchCreateImage },
    } as never);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await caller.createImage({
      ...validInput,
      imageNum: 1,
      params: {
        imageUrl: feedExpandedCollisionReference,
        prompt: 'Regenerate an image',
      },
      sourceGenerationBatchId: 'source-batch-id',
    });

    expect(serverDB.query.generationBatches.findFirst).toHaveBeenCalledTimes(1);
    expect(batchValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          imageReferenceFormatVersion: 1,
          imageUrl: collisionStoredReference,
          prompt: 'Regenerate an image',
        },
      }),
    );
    expect(getKeyFromFullUrl).not.toHaveBeenCalledWith(feedExpandedCollisionReference);
    expect(dispatchCreateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          imageUrl: freshCollisionReference,
          prompt: 'Regenerate an image',
        },
      }),
    );
  });

  it('recovers unversioned root-relative proxy references during regeneration', async () => {
    const rootRelativeReference = '/webapi/files/references/historical.png';
    const feedExpandedReference =
      'https://storage.example.com/webapi/files/references/historical.png';
    const freshReference =
      'https://storage.example.com/references/historical.png?X-Amz-Signature=fresh';
    const batchValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'replacement-batch-id' }]),
    });
    const generationValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'generation-id' }]),
    });
    const asyncTaskValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'task-id' }]),
    });
    const transaction = {
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: batchValues })
        .mockReturnValueOnce({ values: generationValues })
        .mockReturnValueOnce({ values: asyncTaskValues }),
      select: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
    const serverDB = {
      query: {
        generationBatches: {
          findFirst: vi.fn().mockResolvedValue({
            config: {
              imageUrl: rootRelativeReference,
            },
          }),
        },
      },
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const getKeyFromFullUrl = vi.fn((reference: string) => reference);
    const getFullFileUrl = vi.fn(async (key: string) =>
      key === 'references/historical.png' ? freshReference : key,
    );
    const dispatchCreateImage = vi.fn().mockResolvedValue({ success: true });

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl }) as never,
    );
    vi.mocked(createAsyncCaller).mockResolvedValue({
      image: { createImage: dispatchCreateImage },
    } as never);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await caller.createImage({
      ...validInput,
      imageNum: 1,
      params: {
        imageUrl: feedExpandedReference,
        prompt: 'Regenerate an image',
      },
      sourceGenerationBatchId: 'source-batch-id',
    });

    expect(batchValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          imageReferenceFormatVersion: 1,
          imageUrl: 'references/historical.png',
          prompt: 'Regenerate an image',
        },
      }),
    );
    expect(dispatchCreateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          imageUrl: freshReference,
          prompt: 'Regenerate an image',
        },
      }),
    );
  });

  it('rejects ambiguous unversioned bare proxy references during regeneration', async () => {
    const ambiguousStoredReference = 'webapi/files/references/ambiguous.png';
    const serverDB = {
      query: {
        generationBatches: {
          findFirst: vi.fn().mockResolvedValue({
            config: {
              imageUrl: ambiguousStoredReference,
            },
          }),
        },
      },
      transaction: vi.fn(),
    };
    const getFullFileUrl = vi.fn();
    const getKeyFromFullUrl = vi.fn();

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl }) as never,
    );

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await expect(
      caller.createImage({
        ...validInput,
        imageNum: 1,
        params: {
          imageUrl: 'https://storage.example.com/webapi/files/references/ambiguous.png',
          prompt: 'Regenerate an image',
        },
        sourceGenerationBatchId: 'source-batch-id',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Stored image reference format is ambiguous and cannot be regenerated safely',
    });
    expect(serverDB.transaction).not.toHaveBeenCalled();
    expect(getFullFileUrl).not.toHaveBeenCalled();
    expect(getKeyFromFullUrl).not.toHaveBeenCalled();
  });

  it('rejects unsupported stored reference versions during regeneration', async () => {
    const serverDB = {
      query: {
        generationBatches: {
          findFirst: vi.fn().mockResolvedValue({
            config: {
              imageReferenceFormatVersion: 2,
              imageUrl: 'references/future.png',
            },
          }),
        },
      },
      transaction: vi.fn(),
    };
    const getFullFileUrl = vi.fn();
    const getKeyFromFullUrl = vi.fn();

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl }) as never,
    );

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await expect(
      caller.createImage({
        ...validInput,
        imageNum: 1,
        params: {
          imageUrl: 'https://storage.example.com/references/future.png',
          prompt: 'Regenerate an image',
        },
        sourceGenerationBatchId: 'source-batch-id',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Stored image reference format version is not supported',
    });
    expect(serverDB.transaction).not.toHaveBeenCalled();
    expect(getFullFileUrl).not.toHaveBeenCalled();
    expect(getKeyFromFullUrl).not.toHaveBeenCalled();
  });

  it('rejects regeneration from a source batch outside the current user and topic', async () => {
    const serverDB = {
      query: {
        generationBatches: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
      transaction: vi.fn(),
    };

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          getFullFileUrl: vi.fn(),
          getKeyFromFullUrl: vi.fn(),
        }) as never,
    );

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-b',
    } as never);

    await expect(
      caller.createImage({
        ...validInput,
        sourceGenerationBatchId: 'foreign-batch-id',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Source generation batch does not belong to the current user and topic',
    });
    expect(serverDB.transaction).not.toHaveBeenCalled();
  });

  it('rejects image creation when the topic belongs to another user', async () => {
    const topicOwnershipQuery = {
      for: vi.fn().mockResolvedValue([]),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };
    const transaction = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(topicOwnershipQuery),
    };
    const serverDB = {
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-b',
    } as never);

    await expect(caller.createImage(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Generation topic does not belong to the current user',
    });
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it('rejects a fresh reference the user does not own with FORBIDDEN', async () => {
    const foreignReference = 'https://storage.example.com/references/foreign.png?X-Amz-Signature=x';
    const serverDB = { transaction: vi.fn() };
    const getFullFileUrl = vi.fn();
    const getKeyFromFullUrl = vi.fn(() => 'references/foreign.png');
    const isKeyOwnedByUser = vi.fn().mockResolvedValue(false);

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl, isKeyOwnedByUser }) as never,
    );
    mockExistsByAssetKey.mockResolvedValue(false);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await expect(
      caller.createImage({
        ...validInput,
        params: { imageUrl: foreignReference, prompt: 'Generate an image' },
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Image reference does not belong to the current user',
    });
    expect(isKeyOwnedByUser).toHaveBeenCalledWith('references/foreign.png');
    expect(getFullFileUrl).not.toHaveBeenCalled();
    expect(serverDB.transaction).not.toHaveBeenCalled();
  });

  it('normalizes a fresh reference owned via the generations table', async () => {
    const generatedReference =
      'https://storage.example.com/generations/gen-1/image.png?X-Amz-Signature=x';
    const freshGeneratedUrl =
      'https://storage.example.com/generations/gen-1/image.png?X-Amz-Signature=fresh';
    const batchValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'batch-id' }]),
    });
    const generationValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'generation-id' }]),
    });
    const asyncTaskValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'task-id' }]),
    });
    const transaction = {
      insert: vi
        .fn()
        .mockReturnValueOnce({ values: batchValues })
        .mockReturnValueOnce({ values: generationValues })
        .mockReturnValueOnce({ values: asyncTaskValues }),
      select: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
    };
    const serverDB = {
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const getKeyFromFullUrl = vi.fn(() => 'generations/gen-1/image.png');
    const getFullFileUrl = vi.fn(async () => freshGeneratedUrl);
    const isKeyOwnedByUser = vi.fn().mockResolvedValue(false);
    const dispatchCreateImage = vi.fn().mockResolvedValue({ success: true });

    vi.mocked(getServerDB).mockResolvedValue(serverDB as never);
    vi.mocked(FileService).mockImplementation(
      () => ({ getFullFileUrl, getKeyFromFullUrl, isKeyOwnedByUser }) as never,
    );
    vi.mocked(createAsyncCaller).mockResolvedValue({
      image: { createImage: dispatchCreateImage },
    } as never);
    // ownership is proven through the generations table, not the files table
    mockExistsByAssetKey.mockResolvedValue(true);

    const caller = createCallerFactory(imageRouter)({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await caller.createImage({
      ...validInput,
      imageNum: 1,
      params: { imageUrl: generatedReference, prompt: 'Generate an image' },
    });

    expect(mockExistsByAssetKey).toHaveBeenCalledWith('generations/gen-1/image.png');
    expect(isKeyOwnedByUser).not.toHaveBeenCalled();
    expect(batchValues).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ imageUrl: 'generations/gen-1/image.png' }),
      }),
    );
    expect(dispatchCreateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ imageUrl: freshGeneratedUrl }),
      }),
    );
  });

  describe('createImageInputSchema', () => {
    it.each([1, 50])('accepts the image count boundary %i', (imageNum) => {
      expect(createImageInputSchema.parse({ ...validInput, imageNum }).imageNum).toBe(imageNum);
    });

    it.each([0, 51, 1.5])('rejects an invalid image count %s', (imageNum) => {
      expect(() => createImageInputSchema.parse({ ...validInput, imageNum })).toThrow();
    });

    it.each([
      ['generationTopicId', ''],
      ['generationTopicId', '   '],
      ['model', ''],
      ['model', '   '],
      ['provider', ''],
      ['provider', '   '],
    ])('rejects an empty %s', (key, value) => {
      expect(() => createImageInputSchema.parse({ ...validInput, [key]: value })).toThrow();
    });

    it('rejects an empty or whitespace-only prompt', () => {
      expect(() =>
        createImageInputSchema.parse({ ...validInput, params: { prompt: '   ' } }),
      ).toThrow();
    });

    it('trims identifiers and the prompt', () => {
      const result = createImageInputSchema.parse({
        ...validInput,
        generationTopicId: ' topic-id ',
        model: ' gpt-image-1 ',
        params: { prompt: ' Generate an image ' },
        provider: ' openai ',
      });

      expect(result).toMatchObject({
        generationTopicId: 'topic-id',
        model: 'gpt-image-1',
        params: { prompt: 'Generate an image' },
        provider: 'openai',
      });
    });

    it.each(['auto', '1024x1024', '2560x1440', '3840x2160', '2048x2048'])(
      'accepts GPT Image 2 compatible size %s',
      (size) => {
        const result = createImageInputSchema.parse({
          ...gptImage2CompatibleInput,
          params: { ...gptImage2CompatibleInput.params, size },
        });

        expect(result.params.size).toBe(size);
      },
    );

    it('accepts an omitted GPT Image 2 size for provider-default requests', () => {
      expect(createImageInputSchema.parse(gptImage2CompatibleInput).params.size).toBeUndefined();
    });

    it.each([
      ['invalid', 'format'],
      ['1025x1024', 'multiple'],
      ['4096x2048', 'maxEdge'],
      ['3088x1024', 'aspectRatio'],
      ['640x640', 'minPixels'],
      ['3840x2176', 'maxPixels'],
    ])('rejects forged GPT Image 2 compatible size %s', (size, expectedError) => {
      const result = createImageInputSchema.safeParse({
        ...gptImage2CompatibleInput,
        params: { ...gptImage2CompatibleInput.params, size },
      });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: `Invalid GPT Image 2 size: ${expectedError}`,
          path: ['params', 'size'],
        }),
      );
    });

    it.each([
      ['openai', 'gpt-image-2'],
      ['openaicompatible', 'gpt-image-1'],
    ])('does not apply the custom contract to %s/%s', (provider, model) => {
      const result = createImageInputSchema.parse({
        ...validInput,
        model,
        params: { ...validInput.params, size: 'vendor-defined-size' },
        provider,
      });

      expect(result.params.size).toBe('vendor-defined-size');
    });
  });

  describe('validateNoUrlsInConfig utility', () => {
    describe('valid configurations', () => {
      it('should pass with normal keys', () => {
        const config = {
          imageUrl: 'images/photo.jpg',
          imageUrls: ['files/doc.pdf', 'assets/video.mp4'],
          prompt: 'Generate an image',
        };

        expect(() => validateNoUrlsInConfig(config)).not.toThrow();
      });

      it('should pass with empty strings', () => {
        const config = {
          imageUrl: '',
          imageUrls: [],
          prompt: 'Generate an image',
        };

        expect(() => validateNoUrlsInConfig(config)).not.toThrow();
      });

      it('should pass with null/undefined values', () => {
        const config = {
          imageUrl: null,
          imageUrls: undefined,
          prompt: 'Generate an image',
        };

        expect(() => validateNoUrlsInConfig(config)).not.toThrow();
      });
    });

    describe('invalid configurations', () => {
      it('should throw for https URL in imageUrl', () => {
        const config = {
          imageUrl: 'https://s3.amazonaws.com/bucket/image.jpg',
          prompt: 'Generate an image',
        };

        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'Invalid configuration: Found full URL instead of key at imageUrl',
        );
      });

      it('should throw for http URL in imageUrls array', () => {
        const config = {
          imageUrls: ['files/doc.pdf', 'http://example.com/image.jpg'],
          prompt: 'Generate an image',
        };

        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'Invalid configuration: Found full URL instead of key at imageUrls[1]',
        );
      });

      it('should throw for nested URL in complex object', () => {
        const config = {
          settings: {
            imageConfig: {
              url: 'https://cdn.example.com/very-long-url-that-exceeds-100-characters-to-test-truncation-functionality.jpg',
            },
          },
        };

        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'Invalid configuration: Found full URL instead of key at settings.imageConfig.url',
        );
        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'https://cdn.example.com/very-long-url-that-exceeds-100-characters-to-test-truncation-func',
        );
      });

      it('should throw for presigned URL with query parameters', () => {
        const config = {
          imageUrl:
            'https://s3.amazonaws.com/bucket/file.jpg?X-Amz-Signature=abc&X-Amz-Expires=3600',
        };

        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'All URLs must be converted to storage keys before database insertion',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle deeply nested structures', () => {
        const config = {
          level1: {
            level2: {
              level3: {
                level4: ['normal-key', 'https://bad-url.com'],
              },
            },
          },
        };

        expect(() => validateNoUrlsInConfig(config)).toThrow(
          'Invalid configuration: Found full URL instead of key at level1.level2.level3.level4[1]',
        );
      });

      it('should not throw for strings that contain but do not start with http', () => {
        const config = {
          description: 'This text contains http:// but is not a URL',
          imageUrl: 'some-prefix-https://example.com',
        };

        expect(() => validateNoUrlsInConfig(config)).not.toThrow();
      });
    });
  });

  describe('createChatImage (in-chat async generation)', () => {
    const CALLER_USER_ID = 'account-a';
    const makeCallerCtx = (overrides?: Partial<LambdaContext>) =>
      ({
        authorizationHeader: 'test-authorization',
        rawAuthUserId: CALLER_USER_ID,
        userId: CALLER_USER_ID,
        ...overrides,
      }) as LambdaContext;
    const USER_SCOPE = resolveAuthenticatedAccountScope(makeCallerCtx(), enableAuth) ?? 'local';
    const CHAT_CORRELATION = { index: 0, messageId: 'message-1' };
    const CHAT_TASK_ID = deriveChatImageTaskId(
      USER_SCOPE,
      CHAT_CORRELATION.messageId,
      CHAT_CORRELATION.index,
      0,
    );
    const VICTIM_TASK_ID = deriveChatImageTaskId(
      'user:account-b',
      CHAT_CORRELATION.messageId,
      0,
      0,
    );
    const ATTEMPT_1_TASK_ID = deriveChatImageTaskId(USER_SCOPE, CHAT_CORRELATION.messageId, 0, 1);

    // serverDB.transaction stand-in whose select/insert chains mirror the real
    // drizzle calls (including the FOR SHARE read); `rowsProvider` feeds the
    // locked message read so tests can model deletion winning the race
    const makeTxDb = (
      rowsProvider: () => unknown[] | Promise<unknown[]>,
      options?: { insertConflict?: boolean },
    ) => {
      const insertedValues: unknown[] = [];
      const tx = {
        insert: vi.fn(() => ({
          values: (value: unknown) => {
            insertedValues.push(value);
            return {
              onConflictDoNothing: () => ({
                returning: async () => {
                  if (options?.insertConflict) return [];
                  if (Array.isArray(value)) {
                    return value.map((row) => ({ id: (row as { id?: string }).id }));
                  }
                  return [{ id: (value as { id?: string }).id }];
                },
              }),
            };
          },
        })),
        select: vi.fn(() => ({
          from: () => ({
            where: () => ({ limit: () => ({ for: async () => rowsProvider() }) }),
          }),
        })),
      };
      const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
      return { db: { transaction } as never, insertedValues, transaction, tx };
    };

    const correlatedRows = () => [
      { content: JSON.stringify([{ prompt: 'p', taskId: CHAT_TASK_ID }]) },
    ];

    const installCommonMocks = (db: never, dispatch = vi.fn().mockResolvedValue({ ok: true })) => {
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ updatePendingToError: vi.fn() }) as never,
      );
      vi.mocked(createAsyncCaller).mockResolvedValue({
        image: { createChatImage: dispatch },
      } as never);
      vi.mocked(getServerDB).mockResolvedValue(db);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);
      return dispatch;
    };

    const makeCaller = (overrides?: Partial<LambdaContext>) =>
      createCallerFactory(imageRouter)(makeCallerCtx(overrides) as never);

    it('verifies the correlation and inserts the pending task in ONE transaction, then dispatches', async () => {
      const { db, insertedValues, transaction, tx } = makeTxDb(correlatedRows);
      const dispatchChatImage = installCommonMocks(db);

      const result = await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'a rain-washed street at night' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });

      expect(result).toEqual({ taskId: CHAT_TASK_ID });
      expect(transaction).toHaveBeenCalledTimes(1);
      // the locked read ran before the insert, inside the same transaction
      expect(tx.select.mock.invocationCallOrder[0]).toBeLessThan(
        tx.insert.mock.invocationCallOrder[0],
      );
      // the insert is user-scoped and carries the client's write-first id
      expect(insertedValues).toEqual([
        {
          id: CHAT_TASK_ID,
          status: 'pending',
          type: 'image_generation',
          userId: 'account-a',
        },
      ]);
      // the generation itself is dispatched to the async router — the mutation
      // returns immediately and the client polls, never holding a long request
      expect(dispatchChatImage).toHaveBeenCalledWith({
        correlation: {
          attempt: 0,
          index: CHAT_CORRELATION.index,
          messageId: CHAT_CORRELATION.messageId,
        },
        model: 'gpt-image-2',
        params: { prompt: 'a rain-washed street at night' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });
    });

    it('emits chat_image_task_created after a correlated insert', async () => {
      const { db } = makeTxDb(correlatedRows);
      installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });

      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_created',
        expect.objectContaining({
          index: 0,
          outcome: 'inserted',
        }),
      );
      const fields = logSpy.mock.calls.find(
        ([event]) => event === 'chat_image_task_created',
      )?.[1] as {
        messageHash?: string;
        taskHash?: string;
      };
      expect(fields.messageHash).toMatch(/^[\da-f]{16}$/);
      expect(fields.taskHash).toMatch(/^[\da-f]{16}$/);
      expect(JSON.stringify(fields)).not.toContain(CHAT_CORRELATION.messageId);
      expect(JSON.stringify(fields)).not.toContain(CHAT_TASK_ID);
    });

    it('joins chat_image_task_created onto the client send spanId', async () => {
      const { db } = makeTxDb(correlatedRows);
      installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');
      const spanId = 'gd_0123456789abcdef';

      await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        spanId,
        taskId: CHAT_TASK_ID,
      });

      const fields = logSpy.mock.calls.find(
        ([event]) => event === 'chat_image_task_created',
      )?.[1] as {
        spanId?: string;
      };
      expect(fields.spanId).toBe(spanId);
      expect(fields).not.toHaveProperty('prompt');
      expect(JSON.stringify(fields)).not.toContain(CHAT_CORRELATION.messageId);
      expect(JSON.stringify(fields)).not.toContain(CHAT_TASK_ID);
    });

    it('drops an invalid spanId instead of rejecting the billable insert', async () => {
      const { db } = makeTxDb(correlatedRows);
      installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        spanId: 'not-a-span',
        taskId: CHAT_TASK_ID,
      });

      const fields = logSpy.mock.calls.find(
        ([event]) => event === 'chat_image_task_created',
      )?.[1] as {
        spanId?: string;
      };
      expect(fields.spanId).toBeUndefined();
    });

    it('emits chat_image_task_rejected when the message is uncorrelated', async () => {
      const { db } = makeTxDb(() => []);
      installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({
          index: 0,
          outcome: 'uncorrelated',
        }),
      );
      expect(logSpy).not.toHaveBeenCalledWith('chat_image_task_created', expect.anything());
    });

    it('joins chat_image_task_rejected onto the client send spanId', async () => {
      const { db } = makeTxDb(() => []);
      installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');
      const spanId = 'gd_fedcba9876543210';

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          spanId,
          taskId: CHAT_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({
          outcome: 'uncorrelated',
          spanId,
        }),
      );
    });

    it('marks the task failed when the async dispatch rejects', async () => {
      const updatePendingToError = vi.fn().mockResolvedValue(true);
      vi.mocked(AsyncTaskModel).mockImplementation(() => ({ updatePendingToError }) as never);
      let rejectDispatch!: (e: Error) => void;
      const dispatchChatImage = vi.fn().mockReturnValue(
        new Promise((_, reject) => {
          rejectDispatch = reject;
        }),
      );
      vi.mocked(createAsyncCaller).mockResolvedValue({
        image: { createChatImage: dispatchChatImage },
      } as never);
      const { db } = makeTxDb(correlatedRows);
      vi.mocked(getServerDB).mockResolvedValue(db);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });
      rejectDispatch(new Error('dispatch failed'));
      await vi.waitFor(() => expect(updatePendingToError).toHaveBeenCalled());

      expect(updatePendingToError).toHaveBeenCalledWith(
        CHAT_TASK_ID,
        expect.objectContaining({ status: 'error' }),
      );
    });

    it('rejects missing or half-populated correlation input before ANY database work (R16-1)', async () => {
      const { db, insertedValues, transaction } = makeTxDb(correlatedRows);
      const dispatchChatImage = installCommonMocks(db);
      const base = {
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
      };

      // taskId without correlation
      await expect(
        makeCaller().createChatImage({ ...base, taskId: CHAT_TASK_ID } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // correlation without taskId
      await expect(
        makeCaller().createChatImage({ ...base, correlation: CHAT_CORRELATION } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // neither
      await expect(makeCaller().createChatImage(base as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      expect(transaction).not.toHaveBeenCalled();
      expect(insertedValues).toHaveLength(0);
      expect(dispatchChatImage).not.toHaveBeenCalled();
    });

    it('rejects creation when the message is deleted, mutated, resolved, or unparseable (R15-1)', async () => {
      const scenarios: unknown[][] = [
        // deleted message (or deletion committed first — the locked read is empty)
        [],
        // id replaced since persistence
        [
          {
            content: JSON.stringify([
              { prompt: 'p', taskId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
            ]),
          },
        ],
        // already resolved to an image
        [{ content: JSON.stringify([{ imageId: 'img', prompt: 'p', taskId: CHAT_TASK_ID }]) }],
        // content no longer the tool's JSON shape
        [{ content: 'not-json' }],
      ];

      for (const rows of scenarios) {
        const { db, insertedValues } = makeTxDb(() => rows);
        const dispatchChatImage = installCommonMocks(db);

        await expect(
          makeCaller().createChatImage({
            correlation: CHAT_CORRELATION,
            model: 'gpt-image-2',
            params: { prompt: 'p' },
            provider: 'openaicompatible',
            taskId: CHAT_TASK_ID,
          }),
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

        expect(insertedValues).toHaveLength(0);
        expect(dispatchChatImage).not.toHaveBeenCalled();
      }
    });

    it('a deletion that commits during the locked read refuses the insert in the same transaction (R16-1)', async () => {
      // models the FOR SHARE linearization: the read settles only after the
      // concurrent deletion committed, so it observes the post-deletion state
      let commitDeletion!: () => void;
      const deletionCommitted = new Promise<void>((resolve) => {
        commitDeletion = resolve;
      });
      const { db, insertedValues } = makeTxDb(async () => {
        await deletionCommitted;
        return [];
      });
      const dispatchChatImage = installCommonMocks(db);

      const inFlight = makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });
      commitDeletion();

      await expect(inFlight).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(insertedValues).toHaveLength(0);
      expect(dispatchChatImage).not.toHaveBeenCalled();
    });

    it('the correlation lookup is scoped to the calling user (R15-1)', async () => {
      // the WHERE carries userId; the mock proves the query is built with the
      // caller's scope by inspecting the transactional read invocation
      const { db, transaction } = makeTxDb(correlatedRows);
      installCommonMocks(db);

      await makeCaller().createChatImage({
        correlation: CHAT_CORRELATION,
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        taskId: CHAT_TASK_ID,
      });

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects create when the message already carries taskCancelled', async () => {
      const { db, insertedValues } = makeTxDb(() => [
        {
          content: JSON.stringify([{ prompt: 'p', taskCancelled: true, taskId: CHAT_TASK_ID }]),
        },
      ]);
      const dispatchChatImage = installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(insertedValues).toHaveLength(0);
      expect(dispatchChatImage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'stopped' }),
      );
      const fields = logSpy.mock.calls.find(
        ([event]) => event === 'chat_image_task_rejected',
      )?.[1] as { taskHash?: string };
      expect(JSON.stringify(fields)).not.toContain(CHAT_TASK_ID);
    });

    it('rejects a victim UUID embedded in a caller-owned message before insert', async () => {
      const { db, insertedValues } = makeTxDb(() => [
        { content: JSON.stringify([{ prompt: 'p', taskId: VICTIM_TASK_ID }]) },
      ]);
      const dispatchChatImage = installCommonMocks(db);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: VICTIM_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(insertedValues).toHaveLength(0);
      expect(dispatchChatImage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'unproven', scopeKind: 'none' }),
      );
    });

    it('rejects a matching UUID whose attempt, message, or index does not derive', async () => {
      const scenarios = [
        [{ prompt: 'p', taskAttempt: 1, taskId: CHAT_TASK_ID }],
        [{ prompt: 'p', taskId: deriveChatImageTaskId(USER_SCOPE, 'other-message', 0, 0) }],
        [{ prompt: 'p' }, { prompt: 'p', taskId: CHAT_TASK_ID }],
      ] as const;
      const correlations = [
        CHAT_CORRELATION,
        CHAT_CORRELATION,
        { index: 1, messageId: 'message-1' },
      ];
      const taskIds = [
        CHAT_TASK_ID,
        deriveChatImageTaskId(USER_SCOPE, 'other-message', 0, 0),
        CHAT_TASK_ID,
      ];

      for (const [i, content] of scenarios.entries()) {
        const { db, insertedValues } = makeTxDb(() => [{ content: JSON.stringify(content) }]);
        const dispatchChatImage = installCommonMocks(db);

        await expect(
          makeCaller().createChatImage({
            correlation: correlations[i]!,
            model: 'gpt-image-2',
            params: { prompt: 'p' },
            provider: 'openaicompatible',
            taskId: taskIds[i]!,
          }),
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

        expect(insertedValues).toHaveLength(0);
        expect(dispatchChatImage).not.toHaveBeenCalled();
      }
    });

    it('inserts a later attempt when the derived id matches taskAttempt', async () => {
      const { db, insertedValues } = makeTxDb(() => [
        {
          content: JSON.stringify([{ prompt: 'p', taskAttempt: 1, taskId: ATTEMPT_1_TASK_ID }]),
        },
      ]);
      const dispatchChatImage = installCommonMocks(db);

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: ATTEMPT_1_TASK_ID,
        }),
      ).resolves.toEqual({ taskId: ATTEMPT_1_TASK_ID });

      expect(insertedValues).toEqual([
        expect.objectContaining({ id: ATTEMPT_1_TASK_ID, userId: 'account-a' }),
      ]);
      expect(dispatchChatImage).toHaveBeenCalledWith(
        expect.objectContaining({
          correlation: expect.objectContaining({ attempt: 1, index: 0 }),
          taskId: ATTEMPT_1_TASK_ID,
        }),
      );
    });

    it('derives provenance from the raw authenticated principal, not the mapped database owner', async () => {
      const { db, insertedValues } = makeTxDb(correlatedRows);
      const dispatchChatImage = installCommonMocks(db);

      await expect(
        makeCaller({
          rawAuthUserId: CALLER_USER_ID,
          userId: 'mapped-database-owner',
        }).createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).resolves.toEqual({ taskId: CHAT_TASK_ID });

      expect(insertedValues).toEqual([
        expect.objectContaining({ id: CHAT_TASK_ID, userId: 'mapped-database-owner' }),
      ]);
      expect(dispatchChatImage).toHaveBeenCalled();
    });

    it('accepts write-first ids stamped with client local, anonymous, or mapped-owner aliases', async () => {
      const cases = [
        {
          ctx: {},
          scopeKind: 'anonymous',
          taskId: deriveChatImageTaskId('anonymous', CHAT_CORRELATION.messageId, 0, 0),
        },
        {
          ctx: { rawAuthUserId: 'clerk-raw', userId: 'mapped-db' },
          scopeKind: 'mapped',
          taskId: deriveChatImageTaskId('user:mapped-db', CHAT_CORRELATION.messageId, 0, 0),
        },
        {
          ctx: { rawAuthUserId: 'clerk-raw', userId: 'mapped-db' },
          scopeKind: 'local',
          taskId: deriveChatImageTaskId('local', CHAT_CORRELATION.messageId, 0, 0),
        },
      ] as const;

      for (const { ctx, scopeKind, taskId } of cases) {
        const { db, insertedValues } = makeTxDb(() => [
          { content: JSON.stringify([{ prompt: 'p', taskId }]) },
        ]);
        const dispatchChatImage = installCommonMocks(db);
        const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

        await expect(
          makeCaller(ctx).createChatImage({
            correlation: CHAT_CORRELATION,
            model: 'gpt-image-2',
            params: { prompt: 'p' },
            provider: 'openaicompatible',
            taskId,
          }),
        ).resolves.toEqual({ taskId });

        expect(insertedValues).toEqual([expect.objectContaining({ id: taskId })]);
        expect(dispatchChatImage).toHaveBeenCalledWith(expect.objectContaining({ taskId }));
        expect(logSpy).toHaveBeenCalledWith(
          'chat_image_task_created',
          expect.objectContaining({ outcome: 'inserted', scopeKind }),
        );
        logSpy.mockRestore();
      }
    });

    it('does not dispatch when a cancelled placeholder already occupies the task id', async () => {
      const { db } = makeTxDb(correlatedRows, { insertConflict: true });
      const findById = vi.fn().mockResolvedValue({
        error: { name: 'ChatImageTaskCancelled' },
        status: 'error',
      });
      const dispatchChatImage = vi.fn();
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById, updatePendingToError: vi.fn() }) as never,
      );
      vi.mocked(createAsyncCaller).mockResolvedValue({
        image: { createChatImage: dispatchChatImage },
      } as never);
      vi.mocked(getServerDB).mockResolvedValue(db);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

      expect(dispatchChatImage).not.toHaveBeenCalled();
      expect(findById).toHaveBeenCalledWith(CHAT_TASK_ID);
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'stopped' }),
      );
    });

    it('does not treat a generic error row as a Stop tombstone', async () => {
      const { db } = makeTxDb(correlatedRows, { insertConflict: true });
      const findById = vi.fn().mockResolvedValue({
        error: { name: 'ServerError' },
        status: 'error',
      });
      const dispatchChatImage = vi.fn();
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById, updatePendingToError: vi.fn() }) as never,
      );
      vi.mocked(createAsyncCaller).mockResolvedValue({
        image: { createChatImage: dispatchChatImage },
      } as never);
      vi.mocked(getServerDB).mockResolvedValue(db);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).resolves.toEqual({ taskId: CHAT_TASK_ID });

      expect(dispatchChatImage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_created',
        expect.objectContaining({ outcome: 'idempotent' }),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'stopped' }),
      );
    });

    it('does not dispatch when an insert conflict has no same-user task row', async () => {
      const { db } = makeTxDb(correlatedRows, { insertConflict: true });
      const findById = vi.fn().mockResolvedValue(undefined);
      const dispatchChatImage = vi.fn();
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById, updatePendingToError: vi.fn() }) as never,
      );
      vi.mocked(createAsyncCaller).mockResolvedValue({
        image: { createChatImage: dispatchChatImage },
      } as never);
      vi.mocked(getServerDB).mockResolvedValue(db);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);
      const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

      await expect(
        makeCaller().createChatImage({
          correlation: CHAT_CORRELATION,
          model: 'gpt-image-2',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: CHAT_TASK_ID,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      expect(dispatchChatImage).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'conflict' }),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        'chat_image_task_rejected',
        expect.objectContaining({ outcome: 'stopped' }),
      );
    });

    describe('cancelUnstartedChatImageTasks', () => {
      const OTHER_TASK_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const cancelItem = { index: 0, messageId: 'message-1', taskId: CHAT_TASK_ID };
      const tombstoneRow = {
        error: {
          body: { detail: 'Stopped before generation started' },
          name: 'ChatImageTaskCancelled',
        },
        id: CHAT_TASK_ID,
        status: 'error',
        type: 'image_generation',
        userId: 'account-a',
      };

      it('inserts a cancelled placeholder for a caller-owned unpaid correlation', async () => {
        const { db, insertedValues, transaction, tx } = makeTxDb(correlatedRows);
        installCommonMocks(db);
        const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

        const result = await makeCaller().cancelUnstartedChatImageTasks({
          items: [cancelItem, cancelItem],
        });

        expect(result).toEqual({ inserted: 1 });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(tx.select).toHaveBeenCalled();
        expect(insertedValues).toEqual([[tombstoneRow]]);
        expect(logSpy).toHaveBeenCalledWith(
          'chat_image_task_rejected',
          expect.objectContaining({ outcome: 'stopped' }),
        );
        expect(JSON.stringify(logSpy.mock.calls)).not.toContain(CHAT_TASK_ID);
      });

      it('does not overwrite an existing task row', async () => {
        const { db, insertedValues } = makeTxDb(correlatedRows, { insertConflict: true });
        installCommonMocks(db);
        const logSpy = vi.spyOn(generationDebug, 'logGenerationDebugSafe');

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({ items: [cancelItem] }),
        ).resolves.toEqual({ inserted: 0 });

        expect(insertedValues).toEqual([[tombstoneRow]]);
        expect(logSpy).not.toHaveBeenCalled();
      });

      it('skips insert when the message is missing or owned by another user', async () => {
        const { db, insertedValues, tx } = makeTxDb(() => []);
        installCommonMocks(db);

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({ items: [cancelItem] }),
        ).resolves.toEqual({ inserted: 0 });

        expect(tx.select).toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
        expect(insertedValues).toHaveLength(0);
      });

      it('skips insert for an arbitrary task id that is not on the owned message', async () => {
        const { db, insertedValues, tx } = makeTxDb(correlatedRows);
        installCommonMocks(db);

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({
            items: [{ index: 0, messageId: 'message-1', taskId: OTHER_TASK_ID }],
          }),
        ).resolves.toEqual({ inserted: 0 });

        expect(tx.insert).not.toHaveBeenCalled();
        expect(insertedValues).toHaveLength(0);
      });

      it('skips insert when the correlation is mutated or already resolved', async () => {
        const scenarios: unknown[][] = [
          [
            {
              content: JSON.stringify([{ prompt: 'p', taskId: OTHER_TASK_ID }]),
            },
          ],
          [{ content: JSON.stringify([{ imageId: 'img', prompt: 'p', taskId: CHAT_TASK_ID }]) }],
          [{ content: 'not-json' }],
        ];

        for (const rows of scenarios) {
          const { db, insertedValues, tx } = makeTxDb(() => rows);
          installCommonMocks(db);

          await expect(
            makeCaller().cancelUnstartedChatImageTasks({ items: [cancelItem] }),
          ).resolves.toEqual({ inserted: 0 });

          expect(tx.insert).not.toHaveBeenCalled();
          expect(insertedValues).toHaveLength(0);
        }
      });

      it('does not tombstone a victim UUID embedded in a caller-owned message', async () => {
        const { db, insertedValues, tx } = makeTxDb(() => [
          { content: JSON.stringify([{ prompt: 'p', taskId: VICTIM_TASK_ID }]) },
        ]);
        installCommonMocks(db);

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({
            items: [{ index: 0, messageId: 'message-1', taskId: VICTIM_TASK_ID }],
          }),
        ).resolves.toEqual({ inserted: 0 });

        expect(tx.insert).not.toHaveBeenCalled();
        expect(insertedValues).toHaveLength(0);
      });

      it('tombstones an unpaid id stamped with the client anonymous alias', async () => {
        const anonymousId = deriveChatImageTaskId('anonymous', 'message-1', 0, 0);
        const { db, insertedValues } = makeTxDb(() => [
          { content: JSON.stringify([{ prompt: 'p', taskId: anonymousId }]) },
        ]);
        installCommonMocks(db);

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({
            items: [{ index: 0, messageId: 'message-1', taskId: anonymousId }],
          }),
        ).resolves.toEqual({ inserted: 1 });

        expect(insertedValues).toEqual([
          [expect.objectContaining({ id: anonymousId, status: 'error', userId: 'account-a' })],
        ]);
      });

      it('tombstones a later attempt when the derived id matches taskAttempt', async () => {
        const { db, insertedValues } = makeTxDb(() => [
          {
            content: JSON.stringify([{ prompt: 'p', taskAttempt: 1, taskId: ATTEMPT_1_TASK_ID }]),
          },
        ]);
        installCommonMocks(db);

        await expect(
          makeCaller().cancelUnstartedChatImageTasks({
            items: [{ index: 0, messageId: 'message-1', taskId: ATTEMPT_1_TASK_ID }],
          }),
        ).resolves.toEqual({ inserted: 1 });

        expect(insertedValues).toEqual([
          [
            expect.objectContaining({
              id: ATTEMPT_1_TASK_ID,
              status: 'error',
              userId: 'account-a',
            }),
          ],
        ]);
      });

      it('rejects more than 64 items before any database work', async () => {
        const { db, transaction } = makeTxDb(correlatedRows);
        installCommonMocks(db);
        const items = Array.from({ length: 65 }, (_, index) => ({
          index,
          messageId: 'message-1',
          taskId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        }));

        await expect(makeCaller().cancelUnstartedChatImageTasks({ items })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });

        expect(transaction).not.toHaveBeenCalled();
      });
    });
  });

  describe('getChatImageResult', () => {
    it('returns the task status and error while not successful', async () => {
      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            findById: vi
              .fn()
              .mockResolvedValue({ error: { name: 'ServerError' }, status: 'error' }),
          }) as never,
      );
      vi.mocked(getServerDB).mockResolvedValue({} as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      const caller = createCallerFactory(imageRouter)({
        authorizationHeader: 'test-authorization',
        userId: 'account-a',
      } as never);

      const result = await caller.getChatImageResult({ taskId: 'task-3' });

      expect(result).toEqual({ error: { name: 'ServerError' }, status: 'error' });
    });

    it('distinguishes a missing task row from a missing result (R14-1)', async () => {
      // no task row and no file → task_missing (recoverable by same-id resubmit)
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue(undefined) }) as never,
      );
      vi.mocked(FileModel).mockImplementation(
        () => ({ findByChatImageTaskId: vi.fn().mockResolvedValue(undefined) }) as never,
      );
      vi.mocked(getServerDB).mockResolvedValue({} as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      const caller = createCallerFactory(imageRouter)({
        authorizationHeader: 'test-authorization',
        userId: 'account-a',
      } as never);

      await expect(caller.getChatImageResult({ taskId: 'task-none' })).resolves.toEqual({
        status: 'task_missing',
      });

      // success row but the correlated file is gone → result_missing (an
      // authoritative failure only a replacement id can advance)
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue({ status: 'success' }) }) as never,
      );
      vi.mocked(FileModel).mockImplementation(
        () => ({ findByChatImageTaskId: vi.fn().mockResolvedValue(undefined) }) as never,
      );

      await expect(caller.getChatImageResult({ taskId: 'task-lost' })).resolves.toEqual({
        status: 'result_missing',
      });
    });

    it('returns the Artifacts file when the task row is gone', async () => {
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue(undefined) }) as never,
      );
      const findByChatImageTaskId = vi.fn().mockResolvedValue({
        id: 'file-orphan',
        metadata: { chatImageTaskId: 'task-orphan', height: 1024, width: 1024 },
        source: FileSource.ImageGeneration,
      });
      vi.mocked(FileModel).mockImplementation(() => ({ findByChatImageTaskId }) as never);
      vi.mocked(getServerDB).mockResolvedValue({} as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      const caller = createCallerFactory(imageRouter)({
        authorizationHeader: 'test-authorization',
        userId: 'account-a',
      } as never);

      await expect(caller.getChatImageResult({ taskId: 'task-orphan' })).resolves.toEqual({
        file: { height: 1024, id: 'file-orphan', width: 1024 },
        status: 'success',
        taskId: 'task-orphan',
      });
      expect(findByChatImageTaskId).toHaveBeenCalledWith('task-orphan');
    });

    it('returns the linked file (via metadata.chatImageTaskId) on success', async () => {
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue({ status: 'success' }) }) as never,
      );
      const findByChatImageTaskId = vi.fn().mockResolvedValue({
        id: 'file-1',
        metadata: { chatImageTaskId: 'task-4', height: 4096, width: 4096 },
        source: FileSource.ImageGeneration,
      });
      vi.mocked(FileModel).mockImplementation(() => ({ findByChatImageTaskId }) as never);
      vi.mocked(getServerDB).mockResolvedValue({} as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      const caller = createCallerFactory(imageRouter)({
        authorizationHeader: 'test-authorization',
        userId: 'account-a',
      } as never);

      const result = await caller.getChatImageResult({ taskId: 'task-4' });

      expect(findByChatImageTaskId).toHaveBeenCalledWith('task-4');
      expect(result).toEqual({
        file: { height: 4096, id: 'file-1', width: 4096 },
        status: 'success',
        taskId: 'task-4',
      });
    });

    it('does not adopt an ordinary upload whose metadata forges a valid task id', async () => {
      const CALLER_USER_ID = 'account-a';
      const ctx = {
        authorizationHeader: 'test-authorization',
        rawAuthUserId: CALLER_USER_ID,
        userId: CALLER_USER_ID,
      } as LambdaContext;
      const taskId = deriveChatImageTaskId(
        resolveAuthenticatedAccountScope(ctx, enableAuth) ?? 'local',
        'message-1',
        0,
        0,
      );
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue(undefined) }) as never,
      );
      const findByChatImageTaskId = vi.fn().mockResolvedValue({
        id: 'ordinary-upload',
        metadata: { chatImageTaskId: taskId },
      });
      vi.mocked(FileModel).mockImplementation(() => ({ findByChatImageTaskId }) as never);
      vi.mocked(getServerDB).mockResolvedValue({} as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);

      const caller = createCallerFactory(imageRouter)(ctx as never);

      await expect(caller.getChatImageResult({ taskId })).resolves.toEqual({
        status: 'task_missing',
      });
      expect(findByChatImageTaskId).toHaveBeenCalledWith(taskId);
    });
  });

  describe('getChatImageSlotResult', () => {
    const CALLER_USER_ID = 'account-a';
    const makeCallerCtx = (overrides?: Partial<LambdaContext>) =>
      ({
        authorizationHeader: 'test-authorization',
        rawAuthUserId: CALLER_USER_ID,
        userId: CALLER_USER_ID,
        ...overrides,
      }) as LambdaContext;
    const USER_SCOPE = resolveAuthenticatedAccountScope(makeCallerCtx(), enableAuth) ?? 'local';
    const messageId = 'message-1';

    const makeSlotCaller = (
      asyncTaskModel?: { findByIds?: ReturnType<typeof vi.fn> },
      options?: { messageRows?: { content: string }[] },
    ) => {
      vi.mocked(getServerDB).mockResolvedValue({
        select: vi.fn(() => ({
          from: () => ({
            where: () => ({
              limit: async () => options?.messageRows ?? [],
            }),
          }),
        })),
      } as never);
      vi.mocked(FileService).mockImplementation(() => ({}) as never);
      vi.mocked(AsyncTaskModel).mockImplementation(
        () =>
          ({
            findByIds: asyncTaskModel?.findByIds ?? vi.fn().mockResolvedValue([]),
          }) as never,
      );
      return createCallerFactory(imageRouter)(makeCallerCtx() as never);
    };

    it('returns the slotted file without scanning historical task ids', async () => {
      const taskId = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 4);
      const findLatestByChatImageSlot = vi.fn().mockResolvedValue({
        id: 'file-slot',
        metadata: {
          chatImageAttempt: 4,
          chatImageIndex: 0,
          chatImageMessageId: messageId,
          chatImageTaskId: taskId,
          height: 1024,
          width: 1024,
        },
      });
      const findByChatImageTaskIds = vi.fn();
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskIds,
            findLatestByChatImageSlot,
          }) as never,
      );

      const result = await makeSlotCaller().getChatImageSlotResult({ index: 0, messageId });

      expect(findLatestByChatImageSlot).toHaveBeenCalledWith(messageId, 0);
      expect(findByChatImageTaskIds).not.toHaveBeenCalled();
      expect(result).toEqual({
        file: { height: 1024, id: 'file-slot', width: 1024 },
        status: 'success',
        taskAttempt: 4,
        taskId,
      });
    });

    it('picks the highest historical derived attempt when slot metadata is absent', async () => {
      const attempt3 = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 3);
      const attempt9 = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 9);
      const findLatestByChatImageSlot = vi.fn().mockResolvedValue(undefined);
      const findByChatImageTaskIds = vi.fn().mockResolvedValue([
        { id: 'file-3', metadata: { chatImageTaskId: attempt3 } },
        { id: 'file-9', metadata: { chatImageTaskId: attempt9 } },
      ]);
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskIds,
            findLatestByChatImageSlot,
          }) as never,
      );

      const result = await makeSlotCaller().getChatImageSlotResult({ index: 0, messageId });

      expect(findByChatImageTaskIds).toHaveBeenCalled();
      const scanned = findByChatImageTaskIds.mock.calls[0]?.[0] as string[];
      expect(scanned).toContain(attempt3);
      expect(scanned).toContain(attempt9);
      expect(result).toEqual({
        file: { height: undefined, id: 'file-9', width: undefined },
        status: 'success',
        taskAttempt: 9,
        taskId: attempt9,
      });
    });

    it('returns task_missing when no slotted or historical file exists', async () => {
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskIds: vi.fn().mockResolvedValue([]),
            findLatestByChatImageSlot: vi.fn().mockResolvedValue(undefined),
          }) as never,
      );

      await expect(
        makeSlotCaller().getChatImageSlotResult({ index: 1, messageId }),
      ).resolves.toEqual({ status: 'task_missing' });
    });

    it('returns a pending Retry task for the prompt slot', async () => {
      const attempt3 = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 3);
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskIds: vi.fn().mockResolvedValue([]),
            findLatestByChatImageSlot: vi.fn().mockResolvedValue(undefined),
          }) as never,
      );
      const findByIds = vi.fn().mockResolvedValue([{ id: attempt3, status: 'processing' }]);

      await expect(
        makeSlotCaller({ findByIds }).getChatImageSlotResult({ index: 0, messageId }),
      ).resolves.toEqual({
        error: undefined,
        status: 'processing',
        taskAttempt: 3,
        taskId: attempt3,
      });
      expect(findByIds).toHaveBeenCalled();
    });

    it('rejects an ordinary upload whose metadata forges the prompt slot', async () => {
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskIds: vi.fn().mockResolvedValue([]),
            findLatestByChatImageSlot: vi.fn().mockResolvedValue({
              id: 'ordinary-upload',
              metadata: {
                chatImageAttempt: 999,
                chatImageIndex: 0,
                chatImageMessageId: messageId,
                chatImageTaskId: 'not-derived',
              },
            }),
          }) as never,
      );

      await expect(
        makeSlotCaller().getChatImageSlotResult({ index: 0, messageId }),
      ).resolves.toEqual({ status: 'task_missing' });
    });

    it.each([
      ['terminal first', true],
      ['processing first', false],
    ] as const)(
      'returns the live same-attempt alias when a failed alias is %s',
      async (_order, terminalFirst) => {
        const processingId = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 3);
        const errorId = deriveChatImageTaskId('local', messageId, 0, 3);
        vi.mocked(FileModel).mockImplementation(
          () =>
            ({
              findByChatImageTaskId: vi.fn().mockResolvedValue(undefined),
              findByChatImageTaskIds: vi.fn().mockResolvedValue([]),
              findLatestByChatImageSlot: vi.fn().mockResolvedValue(undefined),
            }) as never,
        );
        const rows = [
          { error: { name: 'ImageGenerationError' }, id: errorId, status: 'error' },
          { id: processingId, status: 'processing' },
        ];
        const findByIds = vi.fn().mockResolvedValue(terminalFirst ? rows : [...rows].reverse());

        await expect(
          makeSlotCaller({ findByIds }).getChatImageSlotResult({ index: 0, messageId }),
        ).resolves.toEqual({
          error: undefined,
          status: 'processing',
          taskAttempt: 3,
          taskId: processingId,
        });
      },
    );

    it('discovers a pending attempt above the historical scan from the owned message item', async () => {
      const attempt257 = deriveChatImageTaskId(USER_SCOPE, messageId, 0, 257);
      vi.mocked(FileModel).mockImplementation(
        () =>
          ({
            findByChatImageTaskId: vi.fn().mockResolvedValue(undefined),
            findByChatImageTaskIds: vi.fn().mockResolvedValue([]),
            findLatestByChatImageSlot: vi.fn().mockResolvedValue(undefined),
          }) as never,
      );
      const findByIds = vi.fn().mockResolvedValue([{ id: attempt257, status: 'processing' }]);

      await expect(
        makeSlotCaller(
          { findByIds },
          {
            messageRows: [
              {
                content: JSON.stringify([{ prompt: 'p', taskAttempt: 257, taskId: attempt257 }]),
              },
            ],
          },
        ).getChatImageSlotResult({ index: 0, messageId }),
      ).resolves.toEqual({
        error: undefined,
        status: 'processing',
        taskAttempt: 257,
        taskId: attempt257,
      });
      const scanned = findByIds.mock.calls[0]?.[0] as string[];
      expect(scanned).toContain(attempt257);
      expect(scanned.length).toBeGreaterThan(1);
    });
  });
});
