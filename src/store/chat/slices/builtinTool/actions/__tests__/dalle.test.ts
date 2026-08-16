import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageGenerationService } from '@/services/textToImage';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { DallEImageItem } from '@/types/tool/dalle';

// The Image tool reads the configured (provider, model) from the image store.
// A mutable mock lets tests flip isInit / params.
const { mockImageState } = vi.hoisted(() => ({
  mockImageState: {
    isInit: true,
    model: 'gpt-image-2',
    // include reference-image params to prove they're stripped (finding r1/6)
    parameters: {
      imageUrl: 'ref-single',
      imageUrls: ['ref-plural'],
      prompt: 'ignored',
      size: '1024x1024',
    } as Record<string, unknown>,
    provider: 'openaicompatible',
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    // reset the invalidation generation some tests bump mid-run
    useChatStore.setState({ conversationClearGeneration: 0 });
  });

  describe('generateImageFromPrompts', () => {
    it('does not generate before the image config has initialized (finding r1/1)', async () => {
      mockImageState.isInit = false;
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: JSON.stringify([{ prompt: 'p' }]), id }) as UIChatMessage,
      );
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.generateImageFromPrompts(
          [{ prompt: 'p' }] as DallEImageItem[],
          messageId,
        );
      });

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(updatePluginState).toHaveBeenCalledWith(messageId, {
        error: [{ errorType: 'NoImageModelConfigured' }],
      });
    });

    it('creates async tasks, polls them, and stores only the durable file id (no data: URIs)', async () => {
      vi.useFakeTimers();
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

      let taskCounter = 0;
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async () => ({ taskId: `task-${++taskCounter}` }));
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockImplementation(async (taskId) => ({
          file: { height: 1024, id: `file-for-${taskId}`, width: 1024 },
          status: 'success',
        }));

      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(prompts, messageId);
        // both items poll once after the 2.5 s interval
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      // it passes the configured provider/model, not a hardcoded dall-e-3, and
      // the generation runs as an async task (create + poll), never a long
      // synchronous request
      expect(createTaskMock).toHaveBeenCalledTimes(prompts.length);
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-image-2', provider: 'openaicompatible' }),
      );
      // reference-image params are stripped (finding r1/6); prompt is the item's
      const callParams = (createTaskMock.mock.calls[0][0] as { params: Record<string, unknown> })
        .params;
      expect(callParams.imageUrl).toBeUndefined();
      expect(callParams.imageUrls).toBeUndefined();
      expect(callParams.prompt).toBe('test prompt 1');
      expect(pollMock).toHaveBeenCalledWith('task-1');
      expect(pollMock).toHaveBeenCalledWith('task-2');

      // the persisted content carries the durable file ids and NEVER any
      // image bytes — multi-MB data: URIs were exactly what crashed the chat
      const persistedPayloads = updateContent.mock.calls.map((call) => String(call[1]));
      expect(persistedPayloads.some((p) => p.includes('file-for-task-1'))).toBe(true);
      for (const payload of persistedPayloads) {
        expect(payload).not.toContain('data:');
      }
      // loading toggled on then off per prompt; no failures → no error state
      expect(result.current.toggleDallEImageLoading).toHaveBeenCalledTimes(prompts.length * 2);
      expect(result.current.updatePluginState).not.toHaveBeenCalled();
    });

    it('records a per-index serialized error when a task fails, without throwing', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const initialMessageContent = JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]);

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: initialMessageContent, id }) as UIChatMessage,
      );

      let taskCounter = 0;
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(async () => ({
        taskId: `task-${++taskCounter}`,
      }));
      // first task succeeds, second fails with a categorized task error
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === 'task-1'
          ? { file: { id: 'image-id' }, status: 'success' }
          : {
              error: { body: { detail: 'upstream 503' }, name: 'ServerError' },
              status: 'error',
            },
      );

      vi.spyOn(result.current, 'toggleDallEImageLoading');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue({
        persistenceAmbiguous: false,
      });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }, { prompt: 'p2' }] as DallEImageItem[],
          messageId,
        );
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      // error recorded at index 1 only, as a plain serialized object (an Error
      // instance would lose its message on the jsonb write)
      expect(updatePluginState).toHaveBeenCalledTimes(1);
      const errorArg = updatePluginState.mock.calls[0][1] as { error: unknown[] };
      expect(errorArg.error[0]).toBeUndefined();
      expect(errorArg.error[1]).toEqual({ message: 'upstream 503', name: 'ServerError' });
      expect(result.current.toggleDallEImageLoading).toHaveBeenCalledTimes(4);
    });
  });

  describe('task durability (R9-3)', () => {
    it('persists the taskId at creation so navigation/reload cannot orphan the task', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () =>
          ({ content: JSON.stringify([{ prompt: 'p1' }]), id }) as UIChatMessage,
      );
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockResolvedValue({
        taskId: 'task-live',
      });
      // the task never settles in this tab ("user navigated away / closed it")
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async () => {
        // invalidate the invocation as soon as the first poll happens
        useChatStore.setState({ conversationClearGeneration: 999 });
        return { status: 'processing' };
      });
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }] as DallEImageItem[],
          messageId,
        );
        // first advance fires the poll (which invalidates the invocation);
        // second advance lets the loop observe the invalidation and exit
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      // the correlation was written BEFORE the poll loop ended
      const payloads = updateContent.mock.calls.map((c) => String(c[1]));
      expect(payloads.some((p) => p.includes('"taskId":"task-live"'))).toBe(true);
    });

    it('reconciles a finished background task on mount without creating a new one', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      // "after reload": the persisted item carries the taskId but no image yet
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () =>
          ({
            content: JSON.stringify([{ prompt: 'p1', taskId: 'task-done' }]),
            id,
          }) as UIChatMessage,
      );
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        file: { id: 'file-9' },
        status: 'success',
      });
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        await result.current.reconcileDallETasks(messageId);
      });

      // adopted the server-side result with ZERO new (billable) generations
      expect(createTaskMock).not.toHaveBeenCalled();
      const payloads = updateContent.mock.calls.map((c) => String(c[1]));
      expect(payloads.some((p) => p.includes('"imageId":"file-9"'))).toBe(true);
    });

    it('retry adopts an existing successful task instead of re-billing', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () =>
          ({
            content: JSON.stringify([{ prompt: 'p1', taskId: 'task-done' }]),
            id,
          }) as UIChatMessage,
      );
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        file: { id: 'file-9' },
        status: 'success',
      });
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        await result.current.retryDallEImages(messageId);
      });

      expect(createTaskMock).not.toHaveBeenCalled();
      const payloads = updateContent.mock.calls.map((c) => String(c[1]));
      expect(payloads.some((p) => p.includes('"imageId":"file-9"'))).toBe(true);
    });
  });

  describe('poll error classification (R9-4)', () => {
    it('throws a permanent tRPC/4xx poll error after a single poll instead of retrying it', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () =>
          ({ content: JSON.stringify([{ prompt: 'p1' }]), id }) as UIChatMessage,
      );
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockResolvedValue({
        taskId: 'task-bad',
      });
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(
          Object.assign(new Error('BAD_REQUEST'), { data: { httpStatus: 400 } }),
        );
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue({
        persistenceAmbiguous: false,
      });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }] as DallEImageItem[],
          messageId,
        );
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      // one poll, immediate surfaced error — not five minutes of silent retries
      expect(pollMock).toHaveBeenCalledTimes(1);
      const errorArg = updatePluginState.mock.calls[0][1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({ message: 'BAD_REQUEST' });
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
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue({
        persistenceAmbiguous: false,
      });

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementationOnce(
        (id) => () => ({ content: initialMessageContent, id }) as UIChatMessage,
      );

      await act(async () => {
        await result.current.updateImageItem(messageId, updateFunction);
      });

      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        JSON.stringify([{ imageId: 'new-id', previewUrl: 'new-url', prompt: 'test prompt' }]),
      );
    });
  });
});
