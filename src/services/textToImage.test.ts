import { beforeEach, describe, expect, it, vi } from 'vitest';

import { imageGenerationService } from './textToImage';

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({ 'X-lobe-chat-auth': 'encoded-payload' })),
}));

const { getChatImageResultQuery } = vi.hoisted(() => ({ getChatImageResultQuery: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    image: { getChatImageResult: { query: getChatImageResultQuery } },
  },
}));

describe('imageGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('createChatImageTask', () => {
    it('posts to the collision-free create-chat-image route and returns the task id', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ taskId: 'task-1' }), { status: 200 }),
      );

      const result = await imageGenerationService.createChatImageTask({
        model: 'gpt-image-2',
        params: { prompt: 'a cat' },
        provider: 'comfyui',
      });

      expect(result).toEqual({ taskId: 'task-1' });
      const [url] = vi.mocked(global.fetch).mock.calls[0];
      // /create-image/comfyui is a static synchronous route that would shadow
      // a provider segment — the task bridge must live on its own path
      expect(String(url)).toBe('/webapi/create-chat-image/comfyui');
    });

    it('rejects a wrong-shaped 200 before anyone starts polling (R9-2/R9-4)', async () => {
      // e.g. a route returning an image payload instead of the task contract
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ imageUrl: 'https://x/y.png' }), { status: 200 }),
      );

      await expect(
        imageGenerationService.createChatImageTask({
          model: 'm',
          params: { prompt: 'p' },
          provider: 'comfyui',
        }),
      ).rejects.toThrow('invalid response (expected { taskId })');
    });

    it('sends the client task id and rejects a mismatched echo (R10-1 write-first)', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ taskId: 'different-id' }), { status: 200 }),
      );

      await expect(
        imageGenerationService.createChatImageTask({
          model: 'm',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
          taskId: 'client-uuid',
        }),
      ).rejects.toThrow('answered with a different task id');

      const [, init] = vi.mocked(global.fetch).mock.calls[0];
      expect(String(init?.body)).toContain('"taskId":"client-uuid"');
    });

    it('surfaces a non-OK error body', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ errorType: 'InvalidProviderAPIKey' }), { status: 401 }),
      );

      await expect(
        imageGenerationService.createChatImageTask({
          model: 'm',
          params: { prompt: 'p' },
          provider: 'openaicompatible',
        }),
      ).rejects.toEqual({ errorType: 'InvalidProviderAPIKey' });
    });
  });

  describe('getChatImageResult', () => {
    it('polls with global error notifications suppressed (R9-4)', async () => {
      getChatImageResultQuery.mockResolvedValue({ status: 'processing' });

      await imageGenerationService.getChatImageResult('task-1');

      expect(getChatImageResultQuery).toHaveBeenCalledWith(
        { taskId: 'task-1' },
        { context: { showNotification: false } },
      );
    });
  });
});
