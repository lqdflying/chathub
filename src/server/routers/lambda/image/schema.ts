import { MAX_IMAGE_GENERATION_COUNT, MIN_IMAGE_GENERATION_COUNT } from '@lobechat/const';
import { z } from 'zod';

export const createImageInputSchema = z.object({
  generationTopicId: z.string().trim().min(1),
  imageNum: z.number().int().min(MIN_IMAGE_GENERATION_COUNT).max(MAX_IMAGE_GENERATION_COUNT),
  model: z.string().trim().min(1),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string().trim().min(1),
      seed: z.number().nullable().optional(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string().trim().min(1),
});

export type CreateImageServicePayload = z.infer<typeof createImageInputSchema>;

/**
 * Recursively validate that no full URLs are present in the config.
 * This defensive check ensures only storage keys are persisted.
 */
export const validateNoUrlsInConfig = (obj: unknown, path: string = ''): void => {
  if (typeof obj === 'string') {
    if (obj.startsWith('http://') || obj.startsWith('https://')) {
      throw new Error(
        `Invalid configuration: Found full URL instead of key at ${path || 'root'}. ` +
          `URL: "${obj.slice(0, 100)}${obj.length > 100 ? '...' : ''}". ` +
          `All URLs must be converted to storage keys before database insertion.`,
      );
    }

    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      validateNoUrlsInConfig(item, `${path}[${index}]`);
    });

    return;
  }

  if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key;
      validateNoUrlsInConfig(value, currentPath);
    });
  }
};
