import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { imageGenerationService } from '@/services/textToImage';
import { uploadService } from '@/services/upload';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { DallEImageItem } from '@/types/tool/dalle';

// The Image tool reads the configured (provider, model) from the image store.
// A mutable mock lets tests flip isInit / params.
const { mockImageState } = vi.hoisted(() => ({
  mockImageState: {
    isInit: true,
    model: 'gpt-image-1',
    // include reference-image params to prove they're stripped (finding r1/6)
    parameters: {
      imageUrl: 'ref-single',
      imageUrls: ['ref-plural'],
      prompt: 'ignored',
      size: '1024x1024',
    } as Record<string, unknown>,
    provider: 'openai',
  },
}));
vi.mock('@/store/image', () => ({ getImageStoreState: () => mockImageState }));
vi.mock('@/store/image/slices/generationConfig/modelConfig', () => ({
  getModelAndDefaults: vi.fn(() => ({ defaultValues: {} })),
  isImageModelConfigUsable: vi.fn(() => true),
}));
vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: { enabledImageModelList: () => [] },
  getAiInfraStoreState: () => ({}),
}));

describe('chatToolSlice - dalle', () => {
  afterEach(() => {
    mockImageState.isInit = true;
  });

  describe('generateImageFromPrompts', () => {
    it('does not generate before the image config has initialized (finding r1/1)', async () => {
      mockImageState.isInit = false;
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: JSON.stringify([{ prompt: 'p' }]), id }) as UIChatMessage,
      );
      const createImageMock = vi.spyOn(imageGenerationService, 'createImage');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.generateImageFromPrompts(
          [{ prompt: 'p' }] as DallEImageItem[],
          messageId,
        );
      });

      expect(createImageMock).not.toHaveBeenCalled();
      expect(updatePluginState).toHaveBeenCalledWith(messageId, {
        error: [{ errorType: 'NoImageModelConfigured' }],
      });
    });

    it('generates via createImage, updates items, and uploads images', async () => {
      const { result } = renderHook(() => useChatStore());

      const initialMessageContent = JSON.stringify([
        { prompt: 'test prompt 1' },
        { prompt: 'test prompt 2' },
      ]);

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: initialMessageContent, id }) as UIChatMessage,
      );

      const messageId = 'message-id';
      const prompts = [
        { prompt: 'test prompt 1' },
        { prompt: 'test prompt 2' },
      ] as DallEImageItem[];

      const createImageMock = vi
        .spyOn(imageGenerationService, 'createImage')
        .mockResolvedValue({ height: 512, imageUrl: 'https://example.com/image.png', width: 512 });
      vi.spyOn(uploadService, 'getImageFileByUrlWithCORS').mockResolvedValue(
        new File(['1'], 'file.png', { type: 'image/png' }),
      );

      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        uploadWithProgress: vi.fn().mockResolvedValue({
          dimensions: { height: 512, width: 512 },
          filename: 'file.png',
          id: 'image-id',
          url: '',
        }),
      } as any);

      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.generateImageFromPrompts(prompts, messageId);
      });

      expect(createImageMock).toHaveBeenCalledTimes(prompts.length);
      // it passes the configured provider/model, not a hardcoded dall-e-3
      expect(createImageMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-image-1', provider: 'openai' }),
      );
      // reference-image params are stripped (finding r1/6); prompt is the item's
      const callParams = (createImageMock.mock.calls[0][0] as { params: Record<string, unknown> })
        .params;
      expect(callParams.imageUrl).toBeUndefined();
      expect(callParams.imageUrls).toBeUndefined();
      expect(callParams.prompt).toBe('test prompt 1');
      expect(useFileStore.getState().uploadWithProgress).toHaveBeenCalledTimes(prompts.length);
      // loading toggled on then off per prompt
      expect(result.current.toggleDallEImageLoading).toHaveBeenCalledTimes(prompts.length * 2);
      // no failures → no error state set
      expect(result.current.updatePluginState).not.toHaveBeenCalled();
    });

    it('records a per-index error when generation fails, without throwing', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const initialMessageContent = JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]);

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: initialMessageContent, id }) as UIChatMessage,
      );

      // first prompt succeeds, second fails
      vi.spyOn(imageGenerationService, 'createImage')
        .mockResolvedValueOnce({ imageUrl: 'https://example.com/ok.png' })
        .mockRejectedValueOnce(new Error('boom'));
      vi.spyOn(uploadService, 'getImageFileByUrlWithCORS').mockResolvedValue(
        new File(['1'], 'file.png', { type: 'image/png' }),
      );
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        uploadWithProgress: vi.fn().mockResolvedValue({ id: 'image-id', url: '' }),
      } as any);

      vi.spyOn(result.current, 'toggleDallEImageLoading');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }, { prompt: 'p2' }] as DallEImageItem[],
          messageId,
        );
      });

      // error recorded at index 1 only, and loading always turned back off
      expect(updatePluginState).toHaveBeenCalledTimes(1);
      const errorArg = updatePluginState.mock.calls[0][1] as { error: unknown[] };
      expect(errorArg.error[0]).toBeUndefined();
      expect(errorArg.error[1]).toBeInstanceOf(Error);
      expect(result.current.toggleDallEImageLoading).toHaveBeenCalledTimes(4);
    });
  });

  describe('updateImageItem', () => {
    it('should update image item correctly', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const initialMessageContent = JSON.stringify([
        { imageId: 'old-id', previewUrl: 'old-url', prompt: 'test prompt' },
      ]);
      const updateFunction = (draft: any) => {
        draft[0].previewUrl = 'new-url';
        draft[0].imageId = 'new-id';
      };
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue(undefined);

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementationOnce(
        (id) => () => ({ content: initialMessageContent, id }) as UIChatMessage,
      );
      vi.spyOn(messageService, 'updateMessage').mockResolvedValueOnce(undefined);

      await act(async () => {
        await result.current.updateImageItem(messageId, updateFunction);
      });

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        JSON.stringify([{ imageId: 'new-id', previewUrl: 'new-url', prompt: 'test prompt' }]),
      );
    });
  });

  describe('text2image', () => {
    it('should call generateImageFromPrompts with provided data', async () => {
      const { result } = renderHook(() => useChatStore());
      const id = 'message-id';
      const data = [{ prompt: 'prompt 1' }, { prompt: 'prompt 2' }] as DallEImageItem[];

      const generateImageFromPromptsMock = vi
        .spyOn(result.current, 'generateImageFromPrompts')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.text2image(id, data);
      });

      expect(generateImageFromPromptsMock).toHaveBeenCalledWith(data, id);
    });
  });
});
