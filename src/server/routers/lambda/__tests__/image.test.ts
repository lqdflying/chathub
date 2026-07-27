import { describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { createCallerFactory } from '@/libs/trpc/lambda';

import {
  createImageInputSchema,
  validateNoUrlsInConfig,
} from '@/server/routers/lambda/image/schema';

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
  it('rejects image creation when the topic belongs to another user', async () => {
    const topicOwnershipQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const transaction = {
      select: vi.fn().mockReturnValue(topicOwnershipQuery),
      insert: vi.fn(),
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
          imageUrl: 'some-prefix-https://example.com',
          description: 'This text contains http:// but is not a URL',
        };

        expect(() => validateNoUrlsInConfig(config)).not.toThrow();
      });
    });
  });
});
