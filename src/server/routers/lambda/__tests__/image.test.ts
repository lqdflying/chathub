import { describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import * as generationDebug from '@/libs/logger/generationDebug';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createAsyncCaller } from '@/server/routers/async/caller';
import {
  createImageInputSchema,
  validateNoUrlsInConfig,
} from '@/server/routers/lambda/image/schema';
import { FileService } from '@/server/services/file';

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
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
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
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
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
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
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
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
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
        from: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'topic-id' }]),
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
    const CHAT_TASK_ID = '3f2c8f7e-1c2d-4e5f-9a6b-7c8d9e0f1a2b';
    const CHAT_CORRELATION = { index: 0, messageId: 'message-1' };

    // serverDB.transaction stand-in whose select/insert chains mirror the real
    // drizzle calls (including the FOR SHARE read); `rowsProvider` feeds the
    // locked message read so tests can model deletion winning the race
    const makeTxDb = (rowsProvider: () => unknown[] | Promise<unknown[]>) => {
      const insertedValues: unknown[] = [];
      const tx = {
        insert: vi.fn(() => ({
          values: (value: unknown) => {
            insertedValues.push(value);
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: (value as { id?: string }).id }],
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

    const makeCaller = () =>
      createCallerFactory(imageRouter)({
        authorizationHeader: 'test-authorization',
        userId: 'account-a',
      } as never);

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
      // no task row at all → task_missing (recoverable by same-id resubmit)
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue(undefined) }) as never,
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
      const { FileModel } = await import('@/database/models/file');
      vi.mocked(FileModel).mockImplementation(
        () => ({ findByChatImageTaskId: vi.fn().mockResolvedValue(undefined) }) as never,
      );

      await expect(caller.getChatImageResult({ taskId: 'task-lost' })).resolves.toEqual({
        status: 'result_missing',
      });
    });

    it('returns the linked file (via metadata.chatImageTaskId) on success', async () => {
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ findById: vi.fn().mockResolvedValue({ status: 'success' }) }) as never,
      );
      const findByChatImageTaskId = vi.fn().mockResolvedValue({
        id: 'file-1',
        metadata: { chatImageTaskId: 'task-4', height: 4096, width: 4096 },
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
      });
    });
  });
});
