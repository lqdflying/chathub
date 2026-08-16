import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { imageGenerationService } from '@/services/textToImage';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
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
    // reset state some tests seed/bump mid-run
    useChatStore.setState({ conversationClearGeneration: 0, messagesMap: {} });
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

      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
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
      // the client GENERATES the task ids (write-first correlation) and polls
      // exactly those
      const sentTaskIds = createTaskMock.mock.calls.map(
        (c) => (c[0] as { taskId?: string }).taskId,
      );
      for (const sent of sentTaskIds) {
        expect(sent).toMatch(/^[\da-f-]{36}$/);
        expect(pollMock).toHaveBeenCalledWith(sent);
      }

      // the persisted content carries the durable file ids and NEVER any
      // image bytes — multi-MB data: URIs were exactly what crashed the chat
      const persistedPayloads = updateContent.mock.calls.map((call) => String(call[1]));
      expect(persistedPayloads.some((p) => p.includes(`file-for-${sentTaskIds[0]}`))).toBe(true);
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

      const sentIds: string[] = [];
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => {
          sentIds.push(taskId!);
          return { taskId: taskId! };
        },
      );
      // first task succeeds, second fails with a categorized task error
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === sentIds[0]
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

  describe('task durability (R9-3 / R10-1)', () => {
    // A faithful persistence stand-in: writes mutate the store's messagesMap
    // (persistence itself is conversation-independent), while READS keep the
    // real conversation-scoped getMessageById — nothing here is an
    // always-successful void spy, and no selector is mocked. Injected via
    // setState so `get()` inside the store provably sees it; the caller must
    // invoke the returned restore().
    const installFaithfulPersistence = () => {
      const original = useChatStore.getState().internal_updateMessageContent;
      const impl = vi.fn(async (id: string, content: string) => {
        const map = { ...useChatStore.getState().messagesMap };
        for (const key of Object.keys(map)) {
          map[key] = map[key].map((m: UIChatMessage) => (m.id === id ? { ...m, content } : m));
        }
        useChatStore.setState({ messagesMap: map });
        return { persistenceAmbiguous: false };
      });
      useChatStore.setState({ internal_updateMessageContent: impl as any });
      return { restore: () => useChatStore.setState({ internal_updateMessageContent: original }) };
    };

    const seedConversation = (sessionId: string, message: UIChatMessage) => {
      useChatStore.setState({
        activeId: sessionId,
        activeTopicId: undefined,
        messagesMap: {
          ...useChatStore.getState().messagesMap,
          [messageMapKey(sessionId, undefined)]: [message],
        },
      });
    };

    it('a conversation switch during the in-flight create request cannot orphan the task (R10-1)', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      seedConversation('session-a', {
        content: JSON.stringify([{ prompt: 'p1' }]),
        id: messageId,
        meta: {},
        role: 'system',
      } as UIChatMessage);
      const persistence = installFaithfulPersistence();

      // hold the create request on a deferred promise
      let resolveCreate!: (v: { taskId: string }) => void;
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(
          ({ taskId }) =>
            new Promise((resolve) => {
              resolveCreate = () => resolve({ taskId: taskId! });
            }),
        );
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockImplementation(async (taskId) => ({
          file: { id: `file-of-${taskId}` },
          status: 'success',
        }));
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);

      let run!: Promise<void>;
      await act(async () => {
        run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }] as DallEImageItem[],
          messageId,
        );
        // wait until the create request is actually IN FLIGHT (the write-first
        // persist has already settled by then), then "switch conversations"
        await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalled());
        useChatStore.setState((s) => ({
          activeId: 'other-session',
          conversationClearGeneration: s.conversationClearGeneration + 1,
        }));
        resolveCreate({ taskId: 'ignored' });
        await run;
      });

      // the correlation survived: the ORIGINATING message carries the exact
      // task id that was sent to the server, written before the switch
      const sentTaskId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      const originContent =
        useChatStore.getState().messagesMap[messageMapKey('session-a', undefined)][0].content;
      expect(originContent).toContain(`"taskId":"${sentTaskId}"`);

      // "reopen" the conversation and reconcile: the same task's file is
      // adopted with ZERO additional create calls
      useChatStore.setState({ activeId: 'session-a' });
      await act(async () => {
        await result.current.reconcileDallETasks(messageId);
      });
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(pollMock).toHaveBeenCalledWith(sentTaskId);
      const finalContent =
        useChatStore.getState().messagesMap[messageMapKey('session-a', undefined)][0].content;
      expect(finalContent).toContain(`"imageId":"file-of-${sentTaskId}"`);
      persistence.restore();
    });

    it('concurrent multi-item writes merge instead of clobbering (R10-1 serialization)', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      seedConversation('session-a', {
        content: JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]),
        id: messageId,
        meta: {},
        role: 'system',
      } as UIChatMessage);
      const persistence = installFaithfulPersistence();

      await act(async () => {
        await Promise.all([
          result.current.updateImageItem(messageId, (draft) => {
            if (draft[0]) draft[0].imageId = 'img-0';
          }),
          result.current.updateImageItem(messageId, (draft) => {
            if (draft[1]) draft[1].taskId = 'task-1';
          }),
        ]);
      });

      const content =
        useChatStore.getState().messagesMap[messageMapKey('session-a', undefined)][0].content;
      // out-of-order/concurrent writes must both survive
      expect(content).toContain('"imageId":"img-0"');
      expect(content).toContain('"taskId":"task-1"');
      persistence.restore();
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

  describe('poll error classification (R9-4 / R10-2)', () => {
    const guardedError = (httpStatus: number) =>
      new ToolsRPCResponseError({
        bodyKind: 'html',
        diagnosticId: 'td_gatewayresponse1234',
        durationMs: 12,
        failurePhase: 'response_parse',
        httpStatus,
        mediaType: 'text/html',
        operation: 'finalize_assistant_message',
        reason: 'response_parse_failed',
      });

    const seedItemWithTask = () => {
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () =>
          ({
            content: JSON.stringify([{ prompt: 'p1', taskId: 'task-exist' }]),
            id,
          }) as UIChatMessage,
      );
    };

    it('a guarded HTML 400 poll on an existing task surfaces after ONE poll with zero creations (R10-2)', async () => {
      const { result } = renderHook(() => useChatStore());
      seedItemWithTask();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(guardedError(400));
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      const updatePluginState = vi
        .spyOn(result.current, 'updatePluginState')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue({
        persistenceAmbiguous: false,
      });

      await act(async () => {
        await result.current.generateImageFromPrompts(
          [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
          'message-id',
        );
      });

      expect(pollMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(updatePluginState).toHaveBeenCalledTimes(1);
    });

    it('a plain query auth error on an existing task creates nothing (R10-2)', async () => {
      const { result } = renderHook(() => useChatStore());
      seedItemWithTask();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } }));
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue({
        persistenceAmbiguous: false,
      });

      await act(async () => {
        await result.current.generateImageFromPrompts(
          [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
          'message-id',
        );
      });

      expect(pollMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('a guarded 502 is transient and recovers on the next poll (R10-2)', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: JSON.stringify([{ prompt: 'p1' }]), id }) as UIChatMessage,
      );
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValueOnce(guardedError(502))
        .mockResolvedValueOnce({ file: { id: 'file-ok' }, status: 'success' });
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1' }] as DallEImageItem[],
          'message-id',
        );
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      expect(pollMock).toHaveBeenCalledTimes(2);
      const payloads = updateContent.mock.calls.map((c) => String(c[1]));
      expect(payloads.some((p) => p.includes('"imageId":"file-ok"'))).toBe(true);
    });

    it('only an authoritative terminal task state creates exactly one replacement (R10-2)', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      seedItemWithTask();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === 'task-exist'
          ? { error: { body: { detail: 'expired' }, name: 'ServerError' }, status: 'error' }
          : { file: { id: 'file-new' }, status: 'success' },
      );
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      const updateContent = vi
        .spyOn(result.current, 'internal_updateMessageContent')
        .mockResolvedValue({ persistenceAmbiguous: false });

      await act(async () => {
        const run = result.current.generateImageFromPrompts(
          [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
          'message-id',
        );
        await vi.advanceTimersByTimeAsync(3000);
        await run;
      });

      // the server said the old task terminally failed → exactly one new task
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      const payloads = updateContent.mock.calls.map((c) => String(c[1]));
      expect(payloads.some((p) => p.includes('"imageId":"file-new"'))).toBe(true);
    });

    it('throws a permanent tRPC/4xx poll error after a single poll instead of retrying it', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementation(
        (id) => () => ({ content: JSON.stringify([{ prompt: 'p1' }]), id }) as UIChatMessage,
      );
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockResolvedValue({
        taskId: 'task-bad',
      });
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(Object.assign(new Error('BAD_REQUEST'), { data: { httpStatus: 400 } }));
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
