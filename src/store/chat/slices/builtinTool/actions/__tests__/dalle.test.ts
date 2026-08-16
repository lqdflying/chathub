import { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { imageGenerationService } from '@/services/textToImage';
import { useChatStore } from '@/store/chat';
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

const ORIGIN_SESSION = 'session-a';
const originKey = () => messageMapKey(ORIGIN_SESSION, undefined);

// Seed the ORIGINATING conversation as active, with one tool message. All
// reads in the store go through the real conversation-scoped selectors.
const seedToolMessage = (content: string, messageId = 'message-id') => {
  useChatStore.setState({
    activeId: ORIGIN_SESSION,
    activeTopicId: undefined,
    messagesMap: {
      [originKey()]: [{ content, id: messageId, meta: {}, role: 'system' } as UIChatMessage],
    },
  });
};

// Inject store-method stand-ins via setState so `get()` inside actions
// provably uses them (spying a rendered snapshot does not). The persistence
// stand-in models the REAL behavior: it writes ONLY when the message is
// addressable through the currently-active conversation, and silently
// no-writes otherwise (the real chain's stale/ownership early-returns).
const installStoreStubs = (options?: {
  persistGate?: Promise<void>;
  pluginStateGate?: Promise<void>;
}) => {
  const original = {
    internal_updateMessageContent: useChatStore.getState().internal_updateMessageContent,
    toggleDallEImageLoading: useChatStore.getState().toggleDallEImageLoading,
    updatePluginState: useChatStore.getState().updatePluginState,
  };
  const persistImpl = vi.fn(async (id: string, content: string) => {
    if (options?.persistGate) await options.persistGate;
    const state = useChatStore.getState();
    const activeKey = messageMapKey(state.activeId, state.activeTopicId);
    const list = state.messagesMap[activeKey];
    // real stale/no-write result: resolves without writing anything
    if (!list?.some((m) => m.id === id)) return { persistenceAmbiguous: false };
    useChatStore.setState({
      messagesMap: {
        ...state.messagesMap,
        [activeKey]: list.map((m) => (m.id === id ? { ...m, content } : m)),
      },
    });
    return { persistenceAmbiguous: false };
  });
  const toggleSpy = vi.fn();
  const pluginStateSpy = vi.fn(async () => {
    if (options?.pluginStateGate) await options.pluginStateGate;
    return undefined;
  });
  useChatStore.setState({
    internal_updateMessageContent: persistImpl as any,
    toggleDallEImageLoading: toggleSpy as any,
    updatePluginState: pluginStateSpy as any,
  });
  return {
    persistImpl,
    pluginStateSpy,
    restore: () => useChatStore.setState(original),
    toggleSpy,
  };
};

const originContent = (messageId = 'message-id') =>
  useChatStore.getState().messagesMap[originKey()]?.find((m) => m.id === messageId)?.content ?? '';

const store = () => useChatStore.getState();

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

describe('chatToolSlice - dalle', () => {
  afterEach(() => {
    mockImageState.isInit = true;
    vi.useRealTimers();
    vi.restoreAllMocks();
    useChatStore.setState({
      activeId: ORIGIN_SESSION,
      conversationClearGeneration: 0,
      messagesMap: {},
    });
  });

  describe('generateImageFromPrompts', () => {
    it('does not generate before the image config has initialized (finding r1/1)', async () => {
      mockImageState.isInit = false;
      seedToolMessage(JSON.stringify([{ prompt: 'p' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      await store().generateImageFromPrompts([{ prompt: 'p' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'NoImageModelConfigured' }],
      });
    });

    it('creates async tasks, polls them, and stores only the durable file id (no data: URIs)', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'test prompt 1' }, { prompt: 'test prompt 2' }]));
      const stubs = installStoreStubs();

      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockImplementation(async (taskId) => ({
          file: { height: 1024, id: `file-for-${taskId}`, width: 1024 },
          status: 'success',
        }));

      const run = store().generateImageFromPrompts(
        [{ prompt: 'test prompt 1' }, { prompt: 'test prompt 2' }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      // it passes the configured provider/model, not a hardcoded dall-e-3, and
      // the generation runs as an async task (create + poll)
      expect(createTaskMock).toHaveBeenCalledTimes(2);
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-image-2', provider: 'openaicompatible' }),
      );
      // reference-image params are stripped (finding r1/6); prompt is the item's
      const callParams = (createTaskMock.mock.calls[0][0] as { params: Record<string, unknown> })
        .params;
      expect(callParams.imageUrl).toBeUndefined();
      expect(callParams.imageUrls).toBeUndefined();
      expect(callParams.prompt).toBe('test prompt 1');

      // BOTH client-generated ids were persisted into the ORIGIN message by the
      // single write-first update before any create ran, and both were polled
      const sentTaskIds = createTaskMock.mock.calls.map(
        (c) => (c[0] as { taskId?: string }).taskId!,
      );
      const firstPersist = String(stubs.persistImpl.mock.calls[0][1]);
      for (const sent of sentTaskIds) {
        expect(sent).toMatch(/^[\da-f-]{36}$/);
        expect(firstPersist).toContain(sent);
        expect(pollMock).toHaveBeenCalledWith(sent);
      }

      // the persisted content carries the durable file ids and NEVER any image
      // bytes — multi-MB data: URIs were exactly what crashed the chat
      expect(originContent()).toContain(`file-for-${sentTaskIds[0]}`);
      for (const call of stubs.persistImpl.mock.calls) {
        expect(String(call[1])).not.toContain('data:');
      }
      // loading toggled on then off per prompt; no failures → no error state
      expect(stubs.toggleSpy).toHaveBeenCalledTimes(4);
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });

    it('records a per-index serialized error when a task fails, without throwing', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]));
      const stubs = installStoreStubs();

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
          : { error: { body: { detail: 'upstream 503' }, name: 'ServerError' }, status: 'error' },
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }, { prompt: 'p2' }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      // error recorded at index 1 only, as a plain serialized object (an Error
      // instance would lose its message on the jsonb write)
      expect(stubs.pluginStateSpy).toHaveBeenCalledTimes(1);
      const errorArg = stubs.pluginStateSpy.mock.calls[0][1] as { error: unknown[] };
      expect(errorArg.error[0]).toBeUndefined();
      expect(errorArg.error[1]).toEqual({ message: 'upstream 503', name: 'ServerError' });
      expect(stubs.toggleSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('task durability (R9-3 / R10-1 / R11-1)', () => {
    it('a switch while the write-first persist is pending yields ZERO creates (R11-1)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]));
      // hold the single write-first persistence call open
      let releasePersist!: () => void;
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const stubs = installStoreStubs({ persistGate });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult');

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }, { prompt: 'p2' }] as DallEImageItem[],
        'message-id',
      );
      // switch conversations while the persistence write is held in flight —
      // the stand-in then models the real stale/no-write result
      useChatStore.setState((s) => ({
        activeId: 'other-session',
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      releasePersist();
      await run;
      stubs.restore();

      // the ids were never proven present in the originating message, so no
      // billable task may be created
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).not.toContain('taskId');

      // reopening + reconciling finds nothing to adopt and creates nothing
      useChatStore.setState({ activeId: ORIGIN_SESSION });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('two overlapping retries with identical snapshots produce ONE create and ONE persisted id (R12-1)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      // gate the error-clear await inside retryDallEImages so BOTH retries
      // capture the same id-less snapshot before either generates
      let releasePluginState!: () => void;
      const pluginStateGate = new Promise<void>((resolve) => {
        releasePluginState = resolve;
      });
      const stubs = installStoreStubs({ pluginStateGate });

      let resolveCreate!: () => void;
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

      const retryA = store().retryDallEImages('message-id');
      const retryB = store().retryDallEImages('message-id');
      releasePluginState();

      // exactly ONE invocation owns the item: one create, and the origin
      // message's persisted id equals exactly the created id
      await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      const createdTaskId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      const parsed = JSON.parse(originContent()) as { taskId?: string }[];
      expect(parsed[0]?.taskId).toBe(createdTaskId);

      // the loser settles without overwriting or creating
      await retryB;
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect((JSON.parse(originContent()) as { taskId?: string }[])[0]?.taskId).toBe(createdTaskId);

      // switch away before the winner's create resolves…
      useChatStore.setState((s) => ({
        activeId: 'other-session',
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      resolveCreate();
      await retryA;
      stubs.restore();

      // …reopen and reconcile: the exact created id is queried and adopted,
      // with the create count still one
      useChatStore.setState({ activeId: ORIGIN_SESSION });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(pollMock).toHaveBeenCalledWith(createdTaskId);
      expect(originContent()).toContain(`"imageId":"file-of-${createdTaskId}"`);
    });

    it('a deferred existing-task terminal response after a switch creates ZERO replacements (R11-1)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-exist' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      let resolvePoll!: (v: unknown) => void;
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }) as any,
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
        'message-id',
      );
      await vi.waitFor(() => expect(imageGenerationService.getChatImageResult).toHaveBeenCalled());
      // switch away while the status request is in flight…
      useChatStore.setState((s) => ({
        activeId: 'other-session',
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      // …then the server reports the old task terminally failed
      resolvePoll({ error: { name: 'ServerError' }, status: 'error' });
      await run;
      stubs.restore();

      // ownership is re-checked after the await: no replacement is created
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('a conversation switch during the in-flight create request cannot orphan the task (R10-1)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();

      let resolveCreate!: () => void;
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

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      // wait until the create request is actually IN FLIGHT (the verified
      // write-first persist has already landed by then), then switch away
      await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalled());
      const sentTaskId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      expect(originContent()).toContain(`"taskId":"${sentTaskId}"`);

      useChatStore.setState((s) => ({
        activeId: 'other-session',
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      resolveCreate();
      await run;
      stubs.restore();

      // "reopen" the conversation and reconcile: the same task's file is
      // adopted with ZERO additional create calls
      useChatStore.setState({ activeId: ORIGIN_SESSION });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(pollMock).toHaveBeenCalledWith(sentTaskId);
      expect(originContent()).toContain(`"imageId":"file-of-${sentTaskId}"`);
    });

    it('concurrent multi-item writes merge instead of clobbering (R10-1 serialization)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }]));
      const stubs = installStoreStubs();

      await Promise.all([
        store().updateImageItem('message-id', (draft) => {
          if (draft[0]) draft[0].imageId = 'img-0';
        }),
        store().updateImageItem('message-id', (draft) => {
          if (draft[1]) draft[1].taskId = 'task-1';
        }),
      ]);
      stubs.restore();

      // out-of-order/concurrent writes must both survive
      expect(originContent()).toContain('"imageId":"img-0"');
      expect(originContent()).toContain('"taskId":"task-1"');
    });

    it('reconciles a finished background task on mount without creating a new one', async () => {
      // "after reload": the persisted item carries the taskId but no image yet
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-done' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        file: { id: 'file-9' },
        status: 'success',
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      // adopted the server-side result with ZERO new (billable) generations
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toContain('"imageId":"file-9"');
    });

    it('retry adopts an existing successful task instead of re-billing', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-done' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        file: { id: 'file-9' },
        status: 'success',
      });

      await store().retryDallEImages('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toContain('"imageId":"file-9"');
    });
  });

  describe('poll error classification (R9-4 / R10-2)', () => {
    it('a guarded HTML 400 poll on an existing task surfaces after ONE poll with zero creations (R10-2)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-exist' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(guardedError(400));

      await store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
        'message-id',
      );
      stubs.restore();

      expect(pollMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).toHaveBeenCalledTimes(1);
    });

    it('a plain query auth error on an existing task creates nothing (R10-2)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-exist' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } }));

      await store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
        'message-id',
      );
      stubs.restore();

      expect(pollMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('a guarded 502 is transient and recovers on the next poll (R10-2)', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValueOnce(guardedError(502))
        .mockResolvedValueOnce({ file: { id: 'file-ok' }, status: 'success' });

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      expect(pollMock).toHaveBeenCalledTimes(2);
      expect(originContent()).toContain('"imageId":"file-ok"');
    });

    it('only an authoritative terminal task state creates exactly one replacement (R10-2)', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: 'task-exist' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === 'task-exist'
          ? { error: { body: { detail: 'expired' }, name: 'ServerError' }, status: 'error' }
          : { file: { id: 'file-new' }, status: 'success' },
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: 'task-exist' }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      // the server said the old task terminally failed → exactly one new task
      // whose replacement id was origin-verified before creation
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      const replacementId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      expect(originContent()).toContain(`"taskId":"${replacementId}"`);
      expect(originContent()).toContain('"imageId":"file-new"');
    });

    it('throws a permanent tRPC/4xx poll error after a single poll instead of retrying it', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(Object.assign(new Error('BAD_REQUEST'), { data: { httpStatus: 400 } }));

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      // one poll, immediate surfaced error — not five minutes of silent retries
      expect(pollMock).toHaveBeenCalledTimes(1);
      const errorArg = stubs.pluginStateSpy.mock.calls[0][1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({ message: 'BAD_REQUEST' });
    });
  });

  describe('updateImageItem', () => {
    it('should update image item correctly', async () => {
      seedToolMessage(
        JSON.stringify([{ imageId: 'old-id', previewUrl: 'old-url', prompt: 'test prompt' }]),
      );
      const stubs = installStoreStubs();

      await store().updateImageItem('message-id', (draft: any) => {
        draft[0].previewUrl = 'new-url';
        draft[0].imageId = 'new-id';
      });
      stubs.restore();

      expect(stubs.persistImpl).toHaveBeenCalledWith(
        'message-id',
        JSON.stringify([{ imageId: 'new-id', previewUrl: 'new-url', prompt: 'test prompt' }]),
      );
    });
  });
});
