import { describe, expect, it } from 'vitest';

import {
  createImageInputSchema,
  validateNoUrlsInConfig,
} from '@/server/routers/lambda/image/schema';

const validInput = {
  generationTopicId: 'topic-id',
  imageNum: 4,
  model: 'gpt-image-1',
  params: { prompt: 'Generate an image' },
  provider: 'openai',
};

describe('imageRouter', () => {
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
