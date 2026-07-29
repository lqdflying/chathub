import { describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
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
});
