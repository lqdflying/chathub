import { UIChatMessage } from '@lobechat/types';
import { sha256 } from 'js-sha256';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import { imageGenerationService } from '@/services/textToImage';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
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
  persistRejectOnce?: { done?: boolean };
  persistServerGate?: Promise<void>;
  pluginStateGate?: Promise<void>;
}) => {
  const original = {
    internal_updateMessageContent: useChatStore.getState().internal_updateMessageContent,
    toggleDallEImageLoading: useChatStore.getState().toggleDallEImageLoading,
    updatePluginState: useChatStore.getState().updatePluginState,
  };
  const persistImpl = vi.fn(async (id: string, content: string) => {
    if (options?.persistGate) await options.persistGate;
    if (options?.persistRejectOnce && !options.persistRejectOnce.done) {
      options.persistRejectOnce.done = true;
      throw new Error('persistence write failed');
    }
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
    // the REAL ordering: the optimistic map update above has already happened
    // when the server write is still pending — hold here to model navigation
    // during that in-flight server request
    if (options?.persistServerGate) await options.persistServerGate;
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

// test-side replica of the action's deterministic derivation
const deriveTestTaskId = (seed: string): string => {
  const bytes = new Uint8Array(sha256.arrayBuffer(seed)).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const currentScope = () => authSelectors.currentUserScope(useUserStore.getState()) ?? 'anonymous';
const taskIdForAttempt = (index: number, attempt: number, messageId = 'message-id') =>
  deriveTestTaskId(`chathub-chat-image-task:${currentScope()}:${messageId}:${index}:${attempt}`);
const initialIdFor = (index: number, messageId = 'message-id') =>
  taskIdForAttempt(index, 0, messageId);

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
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
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
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
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
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: initialIdFor(0) }]));
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
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(guardedError(400));

      await store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
        'message-id',
      );
      stubs.restore();

      expect(pollMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).toHaveBeenCalledTimes(1);
    });

    it('a plain query auth error on an existing task creates nothing (R10-2)', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockRejectedValue(Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } }));

      await store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
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
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === validId
          ? { error: { body: { detail: 'expired' }, name: 'ServerError' }, status: 'error' }
          : { file: { id: 'file-new' }, status: 'success' },
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      // the server said the old task terminally failed → exactly one new task
      // whose replacement id was origin-verified before creation
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      const replacementId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      expect(replacementId).toBe(taskIdForAttempt(0, 1));
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

  describe('ownership lifecycle (R13-2)', () => {
    it('navigation during the in-flight server write releases ownership so reconcile polls the persisted id', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      // real ordering: optimistic map write first, server await held
      let releaseServer!: () => void;
      const persistServerGate = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      const stubs = installStoreStubs({ persistServerGate });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockResolvedValue({ file: { id: 'file-x' }, status: 'success' });

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      // the optimistic write has landed; navigate while the server request is
      // still pending, then let it complete
      await vi.waitFor(() => expect(originContent()).toContain('taskId'));
      useChatStore.setState((s) => ({
        activeId: 'other-session',
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      releaseServer();
      await run;
      stubs.restore();

      const persistedId = (JSON.parse(originContent()) as { taskId?: string }[])[0]?.taskId!;
      expect(persistedId).toBeTruthy();
      expect(createTaskMock).not.toHaveBeenCalled();

      // reopen with the PRODUCTION contract: the task row does not exist
      // (task_missing) until the same id is idempotently resubmitted — the
      // old behavior polled not_found for the whole budget and locked Retry
      const created = new Set<string>();
      createTaskMock.mockImplementation(async ({ taskId }) => {
        created.add(taskId!);
        return { taskId: taskId! };
      });
      pollMock.mockImplementation(async (taskId) =>
        created.has(taskId)
          ? { file: { id: 'file-x' }, status: 'success' }
          : { status: 'task_missing' },
      );
      useChatStore.setState({ activeId: ORIGIN_SESSION });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      // reconcile submitted the EXACT persisted id once and adopted its file
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: persistedId }));
      expect(originContent()).toContain('"imageId":"file-x"');
    });

    it('a success task whose result file is gone advances to the deterministic replacement on Retry (R14-1)', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createdIds: string[] = [];
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => {
          createdIds.push(taskId!);
          return { taskId: taskId! };
        });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === validId
          ? { status: 'result_missing' }
          : { file: { id: `file-${taskId}` }, status: 'success' },
      );

      await store().retryDallEImages('message-id');
      stubs.restore();

      // the successful-but-resultless id is NEVER resubmitted; exactly one
      // deterministic replacement is persisted, created, and adopted
      expect(createdIds).not.toContain(validId);
      expect(createdIds).toEqual([taskIdForAttempt(0, 1)]);
      const [replacementId] = createdIds;
      expect(replacementId).toMatch(/^[\da-f-]{36}$/);
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.taskId).toBe(replacementId);
      expect(parsed[0]?.imageId).toBe(`file-${replacementId}`);
    });

    it('a rejected initial persistence does not lock Retry out', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const rejectOnce = { done: false };
      const stubs = installStoreStubs({ persistRejectOnce: rejectOnce });
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        file: { id: 'file-y' },
        status: 'success',
      });

      // first run: the persistence write throws — the run must release its
      // claims on the way out
      await expect(
        store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id'),
      ).rejects.toThrow('persistence write failed');
      expect(createTaskMock).not.toHaveBeenCalled();

      // retry with persistence healthy again: must NOT be locked out
      await store().retryDallEImages('message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(originContent()).toContain('"imageId":"file-y"');
    });

    it('an item queued behind the concurrency limit during invalidation can retry afterwards', async () => {
      vi.useFakeTimers();
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1' }, { prompt: 'p2' }, { prompt: 'p3' }, { prompt: 'p4' }]),
      );
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      // polls never settle; the run only ends via invalidation
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockImplementation(() => new Promise(() => {}) as any);

      const run = store().generateImageFromPrompts(
        [
          { prompt: 'p1' },
          { prompt: 'p2' },
          { prompt: 'p3' },
          { prompt: 'p4' },
        ] as DallEImageItem[],
        'message-id',
      );
      // first three items create and start polling; the fourth waits behind
      // the concurrency-3 limit
      await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(3));
      useChatStore.setState((s) => ({
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      // the polls observe the invalidation on their next tick
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();
      vi.useRealTimers();

      // the fourth item's claim must have been released. Make items 0-2
      // ineligible so ONLY item 4 can act, then prove the retry submits item
      // 4's EXACT persisted deterministic id (task_missing → same-id
      // resubmission) — an aggregate call count would pass even with the leak
      const contentNow = JSON.parse(originContent()) as {
        imageId?: string;
        taskId?: string;
      }[];
      const fourthPersistedId = contentNow[3]?.taskId!;
      expect(fourthPersistedId).toBeTruthy();
      useChatStore.setState((state) => {
        const map = { ...state.messagesMap };
        map[originKey()] = map[originKey()].map((m) =>
          m.id === 'message-id'
            ? {
                ...m,
                content: JSON.stringify(
                  contentNow.map((item, i) => (i < 3 ? { ...item, imageId: `done-${i}` } : item)),
                ),
              }
            : m,
        );
        return { messagesMap: map };
      });

      createTaskMock.mockClear();
      const created = new Set<string>();
      createTaskMock.mockImplementation(async ({ taskId }) => {
        created.add(taskId!);
        return { taskId: taskId! };
      });
      pollMock.mockImplementation(
        async (taskId) =>
          (created.has(taskId)
            ? { file: { id: `file-${taskId}` }, status: 'success' }
            : { status: 'task_missing' }) as any,
      );
      const stubs2 = installStoreStubs();
      await store().retryDallEImages('message-id');
      stubs2.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: fourthPersistedId }),
      );
      const finalParsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(finalParsed[3]?.imageId).toBe(`file-${fourthPersistedId}`);
    });
  });

  describe('reconcile billing authorization (R15-1 / R15-2)', () => {
    it('a message deleted during the deferred probe never authorizes a create (R15-1)', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      let resolvePoll!: (v: unknown) => void;
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }) as any,
      );

      const run = store().reconcileDallETasks('message-id');
      await vi.waitFor(() => expect(imageGenerationService.getChatImageResult).toHaveBeenCalled());
      // delete the message while the probe is in flight — the real deletion
      // paths do NOT bump conversationClearGeneration
      useChatStore.setState({ messagesMap: { [originKey()]: [] } });
      resolvePoll({ status: 'task_missing' });
      await run;
      stubs.restore();

      // deletion is an intentional outcome: no create AND no error card
      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });

    it('a task id replaced mid-probe is never submitted (R15-1)', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      let resolvePoll!: (v: unknown) => void;
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePoll = resolve;
          }) as any,
      );

      const run = store().reconcileDallETasks('message-id');
      await vi.waitFor(() => expect(imageGenerationService.getChatImageResult).toHaveBeenCalled());
      // the item resolved to an image while the probe was in flight
      useChatStore.setState((state) => ({
        messagesMap: {
          ...state.messagesMap,
          [originKey()]: state.messagesMap[originKey()].map((m) =>
            m.id === 'message-id'
              ? {
                  ...m,
                  content: JSON.stringify([
                    { imageId: 'already-done', prompt: 'p1', taskId: validId },
                  ]),
                }
              : m,
          ),
        },
      }));
      resolvePoll({ status: 'task_missing' });
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });

    it('a restored/unproven task id surfaces for Retry instead of billing on view (R15-1)', async () => {
      // an arbitrary UUID that cannot be derived for this message/index
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskId: '11111111-2222-4333-8444-555555555555' }]),
      );
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      // a stable error TYPE (localized by the error card), never English copy
      const errorArg = stubs.pluginStateSpy.mock.calls[0]?.[1] as { error: unknown[] };
      expect(errorArg.error[0]).toEqual({ errorType: 'ChatImageTaskUnverified' });
    });

    it('explicit Retry replaces an unproven id with the derived attempt-0 id (R15-1)', async () => {
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskId: '11111111-2222-4333-8444-555555555555' }]),
      );
      const stubs = installStoreStubs();
      const createdIds: string[] = [];
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => {
          createdIds.push(taskId!);
          return { taskId: taskId! };
        },
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().retryDallEImages('message-id');
      stubs.restore();

      expect(createdIds).not.toContain('11111111-2222-4333-8444-555555555555');
      expect(createdIds).toEqual([initialIdFor(0)]);
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.taskId).toBe(initialIdFor(0));
      expect(parsed[0]?.imageId).toBe(`file-${initialIdFor(0)}`);
    });

    it('recovery waits for image-config initialization instead of erroring, then submits once (R15-2)', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      mockImageState.isInit = false;
      const stubs = installStoreStubs();
      const created = new Set<string>();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => {
          created.add(taskId!);
          return { taskId: taskId! };
        });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        created.has(taskId)
          ? { file: { id: 'file-late' }, status: 'success' }
          : { status: 'task_missing' },
      );

      const run = store().reconcileDallETasks('message-id');
      // config is still hydrating: no create, no false no-model error yet
      await vi.advanceTimersByTimeAsync(1200);
      expect(createTaskMock).not.toHaveBeenCalled();
      // hydration settles — recovery must proceed WITHOUT a remount/Retry
      mockImageState.isInit = true;
      // readiness tick (500 ms) + reconcile's post-create first-poll delay (2.5 s)
      await vi.advanceTimersByTimeAsync(6000);
      await run;
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: validId }));
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      expect(originContent()).toContain('"imageId":"file-late"');
    });

    it('an account/conversation transition during the config wait aborts silently (R15-2)', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      mockImageState.isInit = false;
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      const run = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(700);
      useChatStore.setState((s) => ({
        conversationClearGeneration: s.conversationClearGeneration + 1,
      }));
      await vi.advanceTimersByTimeAsync(1000);
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });
  });

  describe('attempt provenance without a retry cap (R16-3)', () => {
    it('Retry from the attempt-8 descendant advances to exactly attempt 9, never attempt 0', async () => {
      const attempt8 = taskIdForAttempt(0, 8);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskAttempt: 8, taskId: attempt8 }]));
      const stubs = installStoreStubs();
      const createdIds: string[] = [];
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => {
          createdIds.push(taskId);
          return { taskId };
        },
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === attempt8
          ? { error: { name: 'ServerError' }, status: 'error' }
          : { file: { id: `file-${taskId}` }, status: 'success' },
      );

      await store().retryDallEImages('message-id');
      stubs.restore();

      // the validator must accept its own attempt-8 product and advance — a
      // fixed chain cap used to classify attempt 9 as unproven and rewind
      expect(createdIds).toEqual([taskIdForAttempt(0, 9)]);
      const parsed = JSON.parse(originContent()) as {
        taskAttempt?: number;
        taskId?: string;
      }[];
      expect(parsed[0]?.taskId).toBe(taskIdForAttempt(0, 9));
      expect(parsed[0]?.taskAttempt).toBe(9);
    });

    it('reconcile accepts attempt-9 provenance and resubmits the SAME id once', async () => {
      const attempt9 = taskIdForAttempt(0, 9);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskAttempt: 9, taskId: attempt9 }]));
      const stubs = installStoreStubs();
      const created = new Set<string>();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => {
          created.add(taskId);
          return { taskId };
        });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        created.has(taskId)
          ? { file: { id: 'file-9' }, status: 'success' }
          : { status: 'task_missing' },
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      // no restore warning, no rewind — the exact attempt-9 id is completed
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: attempt9 }));
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      expect(originContent()).toContain('"imageId":"file-9"');
    });

    it('a terminal Retry from attempt 9 advances to exactly attempt 10', async () => {
      const attempt9 = taskIdForAttempt(0, 9);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskAttempt: 9, taskId: attempt9 }]));
      const stubs = installStoreStubs();
      const createdIds: string[] = [];
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => {
          createdIds.push(taskId);
          return { taskId };
        },
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === attempt9
          ? { error: { name: 'ServerError' }, status: 'error' }
          : { file: { id: `file-${taskId}` }, status: 'success' },
      );

      await store().retryDallEImages('message-id');
      stubs.restore();

      expect(createdIds).toEqual([taskIdForAttempt(0, 10)]);
      const parsed = JSON.parse(originContent()) as { taskAttempt?: number }[];
      expect(parsed[0]?.taskAttempt).toBe(10);
    });
  });

  describe('late config readiness rerun (R16-2)', () => {
    it('readiness AFTER the bounded wait recovers via the renderer-triggered second invocation', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]));
      mockImageState.isInit = false;
      const stubs = installStoreStubs();
      const created = new Set<string>();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => {
          created.add(taskId);
          return { taskId };
        });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        created.has(taskId)
          ? { file: { id: 'file-late' }, status: 'success' }
          : { status: 'task_missing' },
      );

      const first = store().reconcileDallETasks('message-id');
      // the bounded wait (30 s) expires with hydration still pending
      await vi.advanceTimersByTimeAsync(31_000);
      await first;
      expect(createTaskMock).not.toHaveBeenCalled();
      // silent expiry: no false no-model error was persisted
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();

      // hydration settles later; the renderer's isInit subscription fires a
      // FRESH reconcile (see Render/index.test.tsx) — no remount, no Retry
      mockImageState.isInit = true;
      const second = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(6000);
      await second;
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: validId }));
      expect(originContent()).toContain('"imageId":"file-late"');
    });

    it('an owner transition between expiry and the rerun authorizes nothing', async () => {
      vi.useFakeTimers();
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: initialIdFor(0) }]));
      mockImageState.isInit = false;
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      const first = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(31_000);
      await first;

      // owner transition: conversations invalidated, previous owner's map gone
      useChatStore.setState((state) => ({
        conversationClearGeneration: state.conversationClearGeneration + 1,
        messagesMap: {},
      }));
      mockImageState.isInit = true;
      const second = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(2000);
      await second;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });
  });

  describe('cross-tab convergence (R13-1)', () => {
    it('two isolated tabs sharing one persistence boundary converge on ONE paid task', async () => {
      vi.useFakeTimers();
      // shared last-write-wins persistence + idempotent task server, exactly
      // the production contracts the reviewer inspected
      const sharedContent = { value: JSON.stringify([{ prompt: 'p1' }]) };
      const createdIds: string[] = [];
      const taskServer = new Map<string, { file?: { id: string }; status: string }>();
      const sharedService = {
        createChatImageTask: async ({ taskId }: { taskId?: string }) => {
          if (!taskServer.has(taskId!)) {
            // idempotent same-id insert: only the FIRST create starts a task
            taskServer.set(taskId!, { status: 'processing' });
            createdIds.push(taskId!);
            setTimeout(() => {
              taskServer.set(taskId!, { file: { id: `file-${taskId}` }, status: 'success' });
            }, 100);
          }
          return { taskId: taskId! };
        },
        getChatImageResult: async (taskId: string) =>
          taskServer.get(taskId) ?? { status: 'not_found' },
      };

      const makeTab = async () => {
        vi.resetModules();
        vi.doMock('@/services/textToImage', () => ({ imageGenerationService: sharedService }));
        vi.doMock('@/store/image', () => ({ getImageStoreState: () => mockImageState }));
        vi.doMock('@/store/image/slices/generationConfig/modelConfig', () => ({
          getModelAndDefaults: () => ({ defaultValues: {} }),
          isImageModelConfigUsable: () => true,
        }));
        vi.doMock('@/store/aiInfra', () => ({
          aiProviderSelectors: { enabledImageModelList: () => [] },
          getAiInfraStoreState: () => ({}),
        }));
        vi.doMock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
        vi.doMock('@/store/user/selectors', () => ({
          authSelectors: { currentUserScope: () => 'user-a' },
        }));
        vi.doMock('@/services/file', () => ({ fileService: { getFile: vi.fn() } }));
        vi.doMock('@/libs/swr', () => ({ useClientDataSWR: vi.fn() }));
        vi.doMock('@/store/chat/selectors', () => ({
          chatSelectors: {
            getMessageById: (id: string) => (s: any) =>
              s.messagesMap[messageMapKey(s.activeId, s.activeTopicId)]?.find(
                (m: any) => m.id === id,
              ),
          },
        }));
        const { dalleSlice } = await import('../dalle');

        let state: any;
        const set = (partial: any) => {
          state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
        };
        const get = () => state;
        const syncFromShared = () => {
          state.messagesMap = {
            [originKey()]: [
              { content: sharedContent.value, id: 'message-id', meta: {}, role: 'system' },
            ],
          };
        };
        state = {
          activeId: ORIGIN_SESSION,
          activeTopicId: undefined,
          conversationClearGeneration: 0,
          dalleImageLoading: {},
          internal_updateMessageContent: async (_id: string, content: string) => {
            // unversioned whole-content last-write-wins, like the real model
            sharedContent.value = content;
            syncFromShared();
            return { persistenceAmbiguous: false };
          },
          messagesMap: {},
          toggleDallEImageLoading: () => {},
          updatePluginState: async () => undefined,
        };
        Object.assign(state, dalleSlice(set as any, get as any));
        syncFromShared();
        return { get, syncFromShared };
      };

      const tabA = await makeTab();
      const tabB = await makeTab();

      const runs = Promise.all([
        tabA.get().generateImageFromPrompts([{ prompt: 'p1' }], 'message-id'),
        tabB.get().generateImageFromPrompts([{ prompt: 'p1' }], 'message-id'),
      ]);
      await vi.advanceTimersByTimeAsync(6000);
      await runs;

      // both tabs derived the SAME deterministic id: exactly ONE paid task
      // exists, the shared message holds that exact id, and both adopted its
      // file — no orphaned second generation
      expect(new Set(createdIds).size).toBe(1);
      expect(taskServer.size).toBe(1);
      const [onlyId] = createdIds;
      expect(sharedContent.value).toContain(`"imageId":"file-${onlyId}"`);
      vi.doUnmock('@/services/textToImage');
      vi.doUnmock('@/store/image');
      vi.doUnmock('@/store/image/slices/generationConfig/modelConfig');
      vi.doUnmock('@/store/aiInfra');
      vi.doUnmock('@/store/user');
      vi.doUnmock('@/store/user/selectors');
      vi.doUnmock('@/services/file');
      vi.doUnmock('@/libs/swr');
      vi.doUnmock('@/store/chat/selectors');
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
