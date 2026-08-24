import { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveChatImageTaskId, listChatImageTaskIdScopeAliases } from '@/helpers/chatImageTaskId';
import * as generationDebugClient from '@/libs/logger/generationDebugClient';
import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';
import {
  CHAT_IMAGE_STOP_TOMBSTONE_BATCH_MAX,
  imageGenerationService,
} from '@/services/textToImage';
import { useChatStore } from '@/store/chat';
import {
  bumpLaneScopedClearGeneration,
  isConversationClearFenceCurrent,
  laneScopedClearKey,
} from '@/store/chat/utils/conversationClearGeneration';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
import { findMessageInMessagesMap, messageMapKey } from '@/store/chat/utils/messageMapKey';
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
const seedToolMessage = (
  content: string,
  messageId = 'message-id',
  extras?: Partial<UIChatMessage>,
) => {
  useChatStore.setState({
    activeId: ORIGIN_SESSION,
    activeTopicId: undefined,
    messagesMap: {
      [originKey()]: [
        { content, id: messageId, meta: {}, role: 'system', ...extras } as UIChatMessage,
      ],
    },
  });
};

// Inject store-method stand-ins via setState so `get()` inside actions
// provably uses them (spying a rendered snapshot does not). Persist writes
// into whichever messagesMap entry holds the message (leave-topic is not
// Stop). After a clear-generation bump the write is skipped, matching the
// real `internal_updateMessageContent` Stop fence.
const installStoreStubs = (options?: {
  onPersist?: (callIndex: number, content: string) => void | Promise<void>;
  persistGate?: Promise<void>;
  persistReject?: boolean;
  persistRejectIds?: string[];
  persistRejectOnce?: { done?: boolean };
  persistServerGate?: Promise<void>;
  pluginStateGate?: Promise<void>;
}) => {
  const original = {
    internal_updateMessageContent: useChatStore.getState().internal_updateMessageContent,
    toggleDallEImageLoading: useChatStore.getState().toggleDallEImageLoading,
    updatePluginState: useChatStore.getState().updatePluginState,
  };
  let persistCallCount = 0;
  const persistImpl = vi.fn(
    async (
      id: string,
      content: string,
      extra?: {
        conversationContext?: {
          clearGeneration?: number;
          sessionId?: string;
          threadId?: string | null;
          topicId?: string | null;
        };
        imageList?: UIChatMessage['imageList'];
      },
    ) => {
      const requestedClear =
        extra?.conversationContext?.clearGeneration ??
        useChatStore.getState().conversationClearGeneration;
      if (options?.persistGate) await options.persistGate;
      if (options?.persistReject) {
        throw new Error('persistence write failed');
      }
      if (options?.persistRejectIds?.includes(id)) {
        throw new Error('persistence write failed');
      }
      if (options?.persistRejectOnce && !options.persistRejectOnce.done) {
        options.persistRejectOnce.done = true;
        throw new Error('persistence write failed');
      }
      const state = useChatStore.getState();
      const ctx = extra?.conversationContext;
      const fenceCurrent = ctx?.sessionId
        ? isConversationClearFenceCurrent(
            state,
            requestedClear,
            ctx.sessionId,
            ctx.topicId,
            ctx.threadId,
          )
        : state.conversationClearGeneration === requestedClear;
      if (!fenceCurrent) {
        return { persistenceAmbiguous: false };
      }
      const hit = findMessageInMessagesMap(state.messagesMap, id);
      if (!hit) return { persistenceAmbiguous: false };
      useChatStore.setState({
        messagesMap: {
          ...state.messagesMap,
          [hit.mapKey]: (state.messagesMap[hit.mapKey] ?? []).map((m) =>
            m.id === id
              ? { ...m, content, ...(extra?.imageList ? { imageList: extra.imageList } : {}) }
              : m,
          ),
        },
      });
      persistCallCount += 1;
      await options?.onPersist?.(persistCallCount, content);
      // the REAL ordering: the optimistic map update above has already happened
      // when the server write is still pending — hold here to model navigation
      // during that in-flight server request
      if (options?.persistServerGate) await options.persistServerGate;
      return { persistenceAmbiguous: false };
    },
  );
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

const spyChatImageDebug = () =>
  vi.spyOn(generationDebugClient, 'logDeferredGenerationLane').mockResolvedValue();

const currentScope = () => authSelectors.currentUserScope(useUserStore.getState()) ?? 'anonymous';
const taskIdForAttempt = (index: number, attempt: number, messageId = 'message-id') =>
  deriveChatImageTaskId(currentScope(), messageId, index, attempt);
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

const IMAGE_TOOL_PLUGIN = {
  apiName: 'text2image',
  arguments: '{}',
  identifier: 'lobe-image-designer',
  type: 'builtin' as const,
};

const applyStaleChatImageFetch = (content: string, messageId = 'message-id') => {
  useChatStore.getState().replaceMessages([
    {
      content,
      id: messageId,
      meta: {},
      plugin: IMAGE_TOOL_PLUGIN,
      role: 'tool',
    } as UIChatMessage,
  ]);
};

const probeIdsForAttempt = (attempt: number, index = 0, messageId = 'message-id') => {
  const userState = useUserStore.getState();
  return listChatImageTaskIdScopeAliases({
    authenticatedScope: authSelectors.currentUserScope(userState),
    rawAuthUserId: userState.authUserId,
    userId: userState.user?.id,
  }).map((scope) => ({
    scope,
    taskId: deriveChatImageTaskId(scope, messageId, index, attempt),
  }));
};
const promptOnlyProbeIds = (index = 0, messageId = 'message-id') =>
  probeIdsForAttempt(0, index, messageId);

const CHAT_IMAGE_STOPPED_REGISTRY_KEY = 'chathub:chat-image:stopped-v1';

const stoppedRegistryHas = (taskId: string) => {
  try {
    const raw = globalThis.localStorage.getItem(CHAT_IMAGE_STOPPED_REGISTRY_KEY);
    return Boolean(raw && (JSON.parse(raw) as { ids?: string[] }).ids?.includes(taskId));
  } catch {
    return false;
  }
};

const clearStoppedChatImageTaskStorage = () => {
  try {
    globalThis.localStorage.removeItem(CHAT_IMAGE_STOPPED_REGISTRY_KEY);
    const keys = Object.keys(globalThis.localStorage ?? {}).filter((key) =>
      key.startsWith('chathub:chat-image:stopped:'),
    );
    for (const key of keys) globalThis.localStorage.removeItem(key);
  } catch {
    // jsdom / privacy mode
  }
};

describe('chatToolSlice - dalle', () => {
  beforeEach(() => {
    vi.spyOn(imageGenerationService, 'cancelUnstartedChatImageTasks').mockResolvedValue({
      inserted: 0,
    });
    vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
      status: 'task_missing',
    });
  });

  afterEach(() => {
    mockImageState.isInit = true;
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearStoppedChatImageTaskStorage();
    useChatStore.setState({
      activeId: ORIGIN_SESSION,
      conversationClearGeneration: 0,
      conversationScopedClearGenerations: {},
      deferredBrowserGenerationLanes: {},
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

    it('emits generation-debug lifecycle events for a successful run', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const logSpy = spyChatImageDebug();
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      const events = logSpy.mock.calls.map(([event]) => event);
      expect(events[0]).toBe('chat_image_run_started');
      expect(events.at(-1)).toBe('chat_image_run_settled');
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_started',
        expect.objectContaining({
          imageConfigReady: true,
          itemCount: 1,
          kind: 'generate',
          ownedCount: 1,
          toolName: 'lobe-image-designer',
          visible: true,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_item_settled',
        expect.objectContaining({
          created: true,
          index: 0,
          outcome: 'attached',
          toolName: 'lobe-image-designer',
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({
          attachedCount: 1,
          kind: 'generate',
          outcome: 'ok',
          taskCount: 1,
          toolName: 'lobe-image-designer',
          visible: true,
        }),
      );
    });

    it('emits no_model without creating a task when image config is not ready', async () => {
      mockImageState.isInit = false;
      seedToolMessage(JSON.stringify([{ prompt: 'p' }]));
      const stubs = installStoreStubs();
      const logSpy = spyChatImageDebug();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      await store().generateImageFromPrompts([{ prompt: 'p' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_started',
        expect.objectContaining({ imageConfigReady: false, kind: 'generate' }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({ outcome: 'no_model', toolName: 'lobe-image-designer' }),
      );
      expect(logSpy).not.toHaveBeenCalledWith('chat_image_item_settled', expect.anything());
    });

    it('emits no_origin when the tool message is missing from messagesMap', async () => {
      const logSpy = spyChatImageDebug();

      await store().generateImageFromPrompts([{ prompt: 'p' }] as DallEImageItem[], 'missing-id');

      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({
          outcome: 'no_origin',
          toolName: 'lobe-image-designer',
        }),
      );
      expect(logSpy).not.toHaveBeenCalledWith('chat_image_run_started', expect.anything());
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
      const logSpy = spyChatImageDebug();
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
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({ outcome: 'not_current', toolName: 'lobe-image-designer' }),
      );

      // reopening + reconciling finds nothing to adopt and creates nothing
      useChatStore.setState({ activeId: ORIGIN_SESSION });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('a lane-scoped Stop during write-first persist yields ZERO creates', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      let releasePersist!: () => void;
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const stubs = installStoreStubs({ persistGate });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      releasePersist();
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).not.toContain('taskId');
      expect(useChatStore.getState().conversationClearGeneration).toBe(0);
    });

    it('Stop after the optimistic task-id write does not remount-submit', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      let releaseServer!: () => void;
      const persistServerGate = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      const stubs = installStoreStubs({ persistServerGate });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      await vi.waitFor(() => expect(originContent()).toContain('taskId'));
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      releaseServer();
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toContain('taskId');
      const prepared = JSON.parse(originContent()) as { taskFence?: number; taskId?: string }[];
      expect(typeof prepared[0]?.taskFence).toBe('number');

      createTaskMock.mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('a rejected Stop marker write still does not remount-submit after reload', async () => {
      const validId = initialIdFor(0);
      const preStopContent = JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]);
      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      const stopDurable = vi.fn(async () => {});
      useChatStore.setState({ stopDurableConversationGeneration: stopDurable });
      const stubs = installStoreStubs({ persistReject: true });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      await store().stopGenerateMessage();
      stubs.restore();
      expect(stopDurable).toHaveBeenCalled();

      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('Stop aborts in-flight work before the cancellation write settles', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]),
        'message-id',
        { plugin: IMAGE_TOOL_PLUGIN },
      );
      let releasePersist!: () => void;
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const abortController = new AbortController();
      const stopDurable = vi.fn(async () => {});
      useChatStore.setState({
        mainSendMessageOperations: {
          [originKey()]: { abortController, isLoading: true },
        },
        stopDurableConversationGeneration: stopDurable,
      });
      const stubs = installStoreStubs({ persistGate });

      const stopPromise = store().stopGenerateMessage();
      await vi.waitFor(() => expect(abortController.signal.aborted).toBe(true));
      expect(stopDurable).toHaveBeenCalled();
      let settled = false;
      void stopPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      releasePersist();
      await stopPromise;
      stubs.restore();
    });

    it('records stop ids and aborts the lane before a hung durable cancel returns', async () => {
      const validId = initialIdFor(0);
      const threadId = 'thread-portal';
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]),
        'message-id',
        { plugin: IMAGE_TOOL_PLUGIN, threadId },
      );
      let releaseDurable!: () => void;
      const durableGate = new Promise<void>((resolve) => {
        releaseDurable = resolve;
      });
      const laneKey = laneScopedClearKey(ORIGIN_SESSION, undefined, threadId);
      const laneController = new AbortController();
      const stopDurable = vi.fn(async () => durableGate);
      useChatStore.setState({
        chatLoadingAbortControllersByLane: { [laneKey]: laneController },
        stopDurableConversationGeneration: stopDurable,
      });
      const stubs = installStoreStubs({ persistReject: true });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      const stopPromise = store().stopGenerateMessage({ threadId });
      await vi.waitFor(() => expect(stoppedRegistryHas(validId)).toBe(true));
      await vi.waitFor(() =>
        expect(imageGenerationService.cancelUnstartedChatImageTasks).toHaveBeenCalledWith([
          { index: 0, messageId: 'message-id', taskId: validId },
        ]),
      );
      expect(laneController.signal.aborted).toBe(true);
      expect(stopDurable).toHaveBeenCalled();
      let settled = false;
      void stopPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      clearStoppedChatImageTaskStorage();
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]),
        'message-id',
        { plugin: IMAGE_TOOL_PLUGIN, threadId },
      );
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        error: { name: 'ChatImageTaskCancelled' },
        status: 'error',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();

      releaseDurable();
      await stopPromise;
      stubs.restore();
    });

    it('a V2 Stop still records stop ids before a hung server-cancel lookup returns', async () => {
      const validId = initialIdFor(0);
      const preStopContent = JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]);
      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      let releaseDurable!: () => void;
      const durableGate = new Promise<void>((resolve) => {
        releaseDurable = resolve;
      });
      useChatStore.setState({
        cancelActiveDurableOpsInScope: vi.fn(async () => durableGate),
      });
      const stubs = installStoreStubs({ persistReject: true });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      const stopPromise = store().cancelSendMessageInServer();
      await vi.waitFor(() => expect(stoppedRegistryHas(validId)).toBe(true));
      await vi.waitFor(() =>
        expect(imageGenerationService.cancelUnstartedChatImageTasks).toHaveBeenCalledWith([
          { index: 0, messageId: 'message-id', taskId: validId },
        ]),
      );
      let settled = false;
      void stopPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      clearStoppedChatImageTaskStorage();
      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        error: { name: 'ChatImageTaskCancelled' },
        status: 'error',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();

      releaseDurable();
      await stopPromise;
      stubs.restore();
    });

    it('a failed first message persist still protects a later Image tool message', async () => {
      const idA = initialIdFor(0, 'message-a');
      const idB = initialIdFor(0, 'message-b');
      const contentA = JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: idA }]);
      const contentB = JSON.stringify([{ prompt: 'p2', taskFence: 0, taskId: idB }]);
      useChatStore.setState({
        activeId: ORIGIN_SESSION,
        activeTopicId: undefined,
        messagesMap: {
          [originKey()]: [
            {
              content: contentA,
              id: 'message-a',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
            {
              content: contentB,
              id: 'message-b',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
          ],
        },
      });
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const stubs = installStoreStubs({ persistReject: true });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      await store().stopGenerateMessage();
      stubs.restore();
      expect(stoppedRegistryHas(idA)).toBe(true);
      expect(stoppedRegistryHas(idB)).toBe(true);

      useChatStore.setState((s) => ({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
        messagesMap: {
          ...s.messagesMap,
          [originKey()]: [
            {
              content: contentA,
              id: 'message-a',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
            {
              content: contentB,
              id: 'message-b',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
          ],
        },
      }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-b');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-b', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('still persists later Image tool messages when an earlier cancel write fails', async () => {
      const idA = initialIdFor(0, 'message-a');
      const idB = initialIdFor(0, 'message-b');
      useChatStore.setState({
        activeId: ORIGIN_SESSION,
        activeTopicId: undefined,
        messagesMap: {
          [originKey()]: [
            {
              content: JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: idA }]),
              id: 'message-a',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
            {
              content: JSON.stringify([{ prompt: 'p2', taskFence: 0, taskId: idB }]),
              id: 'message-b',
              meta: {},
              plugin: IMAGE_TOOL_PLUGIN,
              role: 'system',
            } as UIChatMessage,
          ],
        },
        stopDurableConversationGeneration: vi.fn(async () => {}),
      });
      const stubs = installStoreStubs({ persistRejectIds: ['message-a'] });

      await store().stopGenerateMessage();
      stubs.restore();

      const messages = useChatStore.getState().messagesMap[originKey()] ?? [];
      const parsedA = JSON.parse(messages.find((m) => m.id === 'message-a')?.content ?? '[]') as {
        taskCancelled?: boolean;
      }[];
      const parsedB = JSON.parse(messages.find((m) => m.id === 'message-b')?.content ?? '[]') as {
        taskCancelled?: boolean;
      }[];
      expect(parsedA[0]?.taskCancelled).toBeUndefined();
      expect(parsedB[0]?.taskCancelled).toBe(true);
    });

    it('a Stop-marker persist failure logs the affected span and hashed message id', async () => {
      const validId = initialIdFor(0);
      const spanId = 'gd_0123456789abcdef';
      const assistantMessageId = 'assistant-row';
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', spanId, taskFence: 0, taskId: validId }]),
        'message-id',
        { parentId: assistantMessageId, plugin: IMAGE_TOOL_PLUGIN },
      );
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const logSpy = vi.spyOn(generationDebugClient, 'logDeferredGenerationLane');
      const stubs = installStoreStubs({ persistReject: true });

      await store().stopGenerateMessage();
      stubs.restore();

      await vi.waitFor(() =>
        expect(logSpy).toHaveBeenCalledWith(
          'chat_image_run_settled',
          expect.objectContaining({
            assistantMessageId,
            kind: 'stop_mark',
            outcome: 'persist_failed',
            spanId,
          }),
        ),
      );
      const fields = logSpy.mock.calls.find(
        ([event, payload]) =>
          event === 'chat_image_run_settled' &&
          (payload as { kind?: string })?.kind === 'stop_mark',
      )?.[1] as { assistantMessageId?: string; spanId?: string };
      expect(fields.spanId).toBe(spanId);
      expect(fields.assistantMessageId).toBe(assistantMessageId);
      const messageHash =
        await generationDebugClient.hashGenerationDebugClientValue(assistantMessageId);
      const emptyHash = await generationDebugClient.hashGenerationDebugClientValue('');
      expect(messageHash).toMatch(/^[\da-f]{16}$/);
      expect(messageHash).not.toBe(emptyHash);
      expect(JSON.stringify(fields)).not.toContain(validId);
    });

    it('a server cancelled-placeholder still blocks remount create when localStorage cannot store the stop id', async () => {
      const validId = initialIdFor(0);
      const preStopContent = JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]);
      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      const originalSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
        if (String(key).includes('chat-image:stopped')) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        originalSetItem(key, String(value));
      });
      vi.spyOn(imageGenerationService, 'cancelUnstartedChatImageTasks').mockResolvedValue({
        inserted: 1,
      });
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const stubs = installStoreStubs({ persistReject: true });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');

      await store().stopGenerateMessage();
      stubs.restore();
      expect(imageGenerationService.cancelUnstartedChatImageTasks).toHaveBeenCalledWith([
        { index: 0, messageId: 'message-id', taskId: validId },
      ]);

      seedToolMessage(preStopContent, 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        error: { name: 'ChatImageTaskCancelled' },
        status: 'error',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('collects every unpaid id above the server batch limit on Stop', async () => {
      const count = CHAT_IMAGE_STOP_TOMBSTONE_BATCH_MAX + 1;
      const items = Array.from({ length: count }, (_, index) => ({
        prompt: `p${index}`,
        taskFence: 0,
        taskId: initialIdFor(index),
      }));
      seedToolMessage(JSON.stringify(items), 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const stubs = installStoreStubs({ persistReject: true });

      await store().stopGenerateMessage();
      stubs.restore();

      const tombstone = vi.mocked(imageGenerationService.cancelUnstartedChatImageTasks);
      expect(tombstone).toHaveBeenCalledTimes(1);
      expect(tombstone.mock.calls[0][0]).toHaveLength(count);
      expect(tombstone.mock.calls[0][0].map((item) => item.taskId)).toEqual(
        items.map((item) => item.taskId),
      );
    });

    it('tombstones every unpaid id above the local registry bound when persist fails', async () => {
      const count = 257;
      const items = Array.from({ length: count }, (_, index) => ({
        prompt: `p${index}`,
        taskFence: 0,
        taskId: initialIdFor(index),
      }));
      seedToolMessage(JSON.stringify(items), 'message-id', { plugin: IMAGE_TOOL_PLUGIN });
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const stubs = installStoreStubs({ persistReject: true });

      await store().stopGenerateMessage();
      stubs.restore();

      const tombstone = vi.mocked(imageGenerationService.cancelUnstartedChatImageTasks);
      const sentIds = tombstone.mock.calls.flatMap(([payload]) =>
        payload.map((item) => item.taskId),
      );
      expect(sentIds).toHaveLength(count);
      expect(new Set(sentIds).size).toBe(count);

      const oldestId = items[0]!.taskId;
      expect(stoppedRegistryHas(oldestId)).toBe(false);
      expect(sentIds).toContain(oldestId);
      clearStoppedChatImageTaskStorage();
      seedToolMessage(
        JSON.stringify([{ prompt: 'p0', taskFence: 0, taskId: oldestId }]),
        'message-id',
        { plugin: IMAGE_TOOL_PLUGIN },
      );
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        error: { name: 'ChatImageTaskCancelled' },
        status: 'error',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('does not drop a new unpaid tile because historical cancelled tiles would overflow the batch', async () => {
      const historical = Array.from(
        { length: CHAT_IMAGE_STOP_TOMBSTONE_BATCH_MAX },
        (_, index) => ({
          prompt: `old${index}`,
          taskCancelled: true,
          taskFence: 0,
          taskId: initialIdFor(index),
        }),
      );
      const unpaidId = initialIdFor(CHAT_IMAGE_STOP_TOMBSTONE_BATCH_MAX);
      seedToolMessage(
        JSON.stringify([...historical, { prompt: 'new', taskFence: 0, taskId: unpaidId }]),
        'message-id',
        { plugin: IMAGE_TOOL_PLUGIN },
      );
      useChatStore.setState({ stopDurableConversationGeneration: vi.fn(async () => {}) });
      const stubs = installStoreStubs({ persistReject: true });

      await store().stopGenerateMessage();
      stubs.restore();

      expect(imageGenerationService.cancelUnstartedChatImageTasks).toHaveBeenCalledTimes(1);
      expect(imageGenerationService.cancelUnstartedChatImageTasks).toHaveBeenCalledWith([
        {
          index: CHAT_IMAGE_STOP_TOMBSTONE_BATCH_MAX,
          messageId: 'message-id',
          taskId: unpaidId,
        },
      ]);
    });

    it('a later generate after a prior lane Stop still runs (global epoch stays 0)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      useChatStore.setState((s) => ({
        conversationClearGeneration: 0,
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalled();
      expect(originContent()).toContain('taskId');
      expect(originContent()).toContain('imageId');
    });

    it('a main-lane Stop does not fence a portal-thread image run', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]), 'message-id', { threadId: 'portal-1' });
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalled();
      expect(originContent()).toContain('imageId');
    });

    it('a portal-thread Stop does not fence a main-lane image run', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, 'portal-1'),
      }));
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalled();
      expect(originContent()).toContain('imageId');
    });

    it('forwards the send spanId on createChatImageTask when a deferred lane exists', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]), 'message-id', {
        parentId: 'assistant-1',
      });
      const laneKey = deferredBrowserGenerationLaneKey(ORIGIN_SESSION, undefined, null);
      useChatStore.setState({
        deferredBrowserGenerationLanes: {
          [laneKey]: {
            assistantMessageId: 'assistant-1',
            reason: 'unsupported_tool',
            spanId: 'gd_0123456789abcdef',
            toolName: 'lobe-image-designer',
          },
        },
      });
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ spanId: 'gd_0123456789abcdef' }),
      );
      expect(originContent()).toContain('"spanId":"gd_0123456789abcdef"');
      expect(originContent()).toContain('"taskFence"');
    });

    it('leaving the originating topic still persists and creates (leave is not Stop)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const logSpy = spyChatImageDebug();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      await vi.waitFor(() => expect(createTaskMock).toHaveBeenCalled());
      useChatStore.setState({
        activeId: 'other-session',
        activeTopicId: 'other-topic',
      });
      await run;
      stubs.restore();

      const sentTaskId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      expect(originContent()).toContain(`"taskId":"${sentTaskId}"`);
      expect(originContent()).toContain(`"imageId":"file-${sentTaskId}"`);
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_item_settled',
        expect.objectContaining({
          created: true,
          outcome: 'attached',
          toolName: 'lobe-image-designer',
          visible: false,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({
          attachedCount: 1,
          outcome: 'ok',
          taskCount: 1,
          visible: false,
        }),
      );
    });

    it('resolves the originating map after the user already left the topic', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      useChatStore.setState({
        activeId: 'other-session',
        activeTopicId: 'other-topic',
      });
      const stubs = installStoreStubs();
      const logSpy = spyChatImageDebug();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      await store().generateImageFromPrompts([{ prompt: 'p1' }] as DallEImageItem[], 'message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      const sentTaskId = (createTaskMock.mock.calls[0][0] as { taskId?: string }).taskId!;
      expect(originContent()).toContain(`"imageId":"file-${sentTaskId}"`);
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_started',
        expect.objectContaining({
          toolName: 'lobe-image-designer',
          visible: false,
        }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({
          attachedCount: 1,
          outcome: 'ok',
          visible: false,
        }),
      );
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

    it('keeps a Retry tuple when a stale Stop fetch lands before write verification', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      const retried = taskIdForAttempt(0, 1);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]), 'message-id', {
        plugin: IMAGE_TOOL_PLUGIN,
        role: 'tool',
      });
      const stubs = installStoreStubs({
        onPersist: (callIndex) => {
          if (callIndex !== 2) return;
          applyStaleChatImageFetch(
            JSON.stringify([
              {
                prompt: 'p1',
                taskAttempt: 0,
                taskCancelled: true,
                taskFence: 1,
                taskId: validId,
              },
            ]),
          );
        },
      });
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === validId
          ? { error: { body: { detail: 'expired' }, name: 'ServerError' }, status: 'error' }
          : { file: { id: `file-${taskId}` }, status: 'success' },
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: retried }));
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskCancelled?: boolean;
        taskId?: string;
      }[];
      expect(parsed[0]?.taskId).toBe(retried);
      expect(parsed[0]?.taskAttempt).toBe(1);
      expect(parsed[0]?.taskCancelled).toBeUndefined();
      expect(parsed[0]?.imageId).toBe(`file-${retried}`);
    });

    it('persists the Retry file when a stale Stop fetch lands after verification', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      const retried = taskIdForAttempt(0, 1);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: validId }]), 'message-id', {
        plugin: IMAGE_TOOL_PLUGIN,
        role: 'tool',
      });
      const stubs = installStoreStubs();
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => {
          applyStaleChatImageFetch(
            JSON.stringify([
              {
                prompt: 'p1',
                taskAttempt: 0,
                taskCancelled: true,
                taskFence: 1,
                taskId: validId,
              },
            ]),
          );
          return { taskId: taskId! };
        });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === validId
          ? { error: { body: { detail: 'expired' }, name: 'ServerError' }, status: 'error' }
          : { file: { id: `file-${taskId}` }, status: 'success' },
      );

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1', taskId: validId }] as DallEImageItem[],
        'message-id',
      );
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: retried }));
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskCancelled?: boolean;
        taskId?: string;
      }[];
      expect(parsed[0]?.taskId).toBe(retried);
      expect(parsed[0]?.taskAttempt).toBe(1);
      expect(parsed[0]?.taskCancelled).toBeUndefined();
      expect(parsed[0]?.imageId).toBe(`file-${retried}`);
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
    it('leave-topic during the in-flight server persist still creates (leave is not Stop)', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      let releaseServer!: () => void;
      const persistServerGate = new Promise<void>((resolve) => {
        releaseServer = resolve;
      });
      const stubs = installStoreStubs({ persistServerGate });
      const createTaskMock = vi
        .spyOn(imageGenerationService, 'createChatImageTask')
        .mockImplementation(async ({ taskId }) => ({ taskId: taskId! }));
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      const run = store().generateImageFromPrompts(
        [{ prompt: 'p1' }] as DallEImageItem[],
        'message-id',
      );
      await vi.waitFor(() => expect(originContent()).toContain('taskId'));
      useChatStore.setState({ activeId: 'other-session' });
      releaseServer();
      await run;
      stubs.restore();

      const persistedId = (JSON.parse(originContent()) as { taskId?: string }[])[0]?.taskId!;
      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: persistedId }));
      expect(originContent()).toContain(`"imageId":"file-${persistedId}"`);
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
      const logSpy = spyChatImageDebug();
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
      expect(logSpy).toHaveBeenCalledWith(
        'chat_image_run_settled',
        expect.objectContaining({ outcome: 'failed', toolName: 'lobe-image-designer' }),
      );

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

    it('adopts a finished derived task when tile content is prompt-only (stale fetch wipe)', async () => {
      const recoveredId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) =>
        taskId === recoveredId
          ? { file: { id: 'file-from-artifacts' }, status: 'success' }
          : { status: 'task_missing' },
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-from-artifacts');
      expect(parsed[0]?.taskId).toBe(recoveredId);
    });

    it('adopts a finished Retry attempt from the slot lookup', async () => {
      const attempt3 = taskIdForAttempt(0, 3);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi.spyOn(imageGenerationService, 'getChatImageResult');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        file: { id: 'file-from-retry' },
        status: 'success',
        taskAttempt: 3,
        taskId: attempt3,
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskId?: string;
      }[];
      expect(parsed[0]?.imageId).toBe('file-from-retry');
      expect(parsed[0]?.taskAttempt).toBe(3);
      expect(parsed[0]?.taskId).toBe(attempt3);
    });

    it('adopts Retry attempt 9 from the slot lookup without probing earlier ids', async () => {
      const attempt9 = taskIdForAttempt(0, 9);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi.spyOn(imageGenerationService, 'getChatImageResult');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        file: { id: 'file-from-attempt-9' },
        status: 'success',
        taskAttempt: 9,
        taskId: attempt9,
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskId?: string;
      }[];
      expect(parsed[0]?.imageId).toBe('file-from-attempt-9');
      expect(parsed[0]?.taskAttempt).toBe(9);
      expect(parsed[0]?.taskId).toBe(attempt9);
    });

    it('polls a pending Retry attempt until the file appears without creating', async () => {
      vi.useFakeTimers();
      const attempt3 = taskIdForAttempt(0, 3);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'processing',
        taskAttempt: 3,
        taskId: attempt3,
      });
      let polls = 0;
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId !== attempt3) return { status: 'task_missing' };
        polls += 1;
        if (polls === 1) return { status: 'processing' };
        return { file: { id: 'file-from-pending' }, status: 'success' };
      });

      const run = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskId?: string;
      }[];
      expect(parsed[0]?.imageId).toBe('file-from-pending');
      expect(parsed[0]?.taskAttempt).toBe(3);
      expect(parsed[0]?.taskId).toBe(attempt3);
    });

    it('surfaces a transient slot lookup failure instead of leaving a blank tile', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockRejectedValue(
        Object.assign(new Error('slot unavailable'), { data: { httpStatus: 503 } }),
      );
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockResolvedValue({ status: 'task_missing' });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [expect.objectContaining({ message: 'slot unavailable' })],
      });
      const parsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(parsed[0]?.imageId).toBeUndefined();
    });

    it('does not attach when every derived attempt-0 probe is task_missing', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'task_missing',
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(parsed[0]?.imageId).toBeUndefined();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['terminal first', true],
      ['processing first', false],
    ] as const)(
      'attaches the live same-attempt alias when a failed alias is %s',
      async (_order, terminalFirst) => {
        vi.useFakeTimers();
        const userState = useUserStore.getState();
        const probes = listChatImageTaskIdScopeAliases({
          authenticatedScope: authSelectors.currentUserScope(userState),
          rawAuthUserId: userState.authUserId,
          userId: userState.user?.id,
        }).map((scope) => ({
          taskId: deriveChatImageTaskId(scope, 'message-id', 0, 3),
        }));
        expect(probes.length).toBeGreaterThanOrEqual(2);
        const terminalId = probes[0]?.taskId as string;
        const successId = probes[1]?.taskId as string;
        seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
        const stubs = installStoreStubs();
        const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
        vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
          status: 'error',
          taskAttempt: 3,
          taskId: terminalFirst ? terminalId : successId,
        });
        let successPolls = 0;
        vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(
          async (taskId) => {
            if (taskId === terminalId) {
              return {
                error: { body: { detail: 'stopped' }, name: 'ImageGenerationError' },
                status: 'error',
              };
            }
            if (taskId === successId) {
              successPolls += 1;
              if (successPolls === 1) return { status: 'processing' };
              return { file: { id: 'file-from-live-alias' }, status: 'success' };
            }
            return { status: 'task_missing' };
          },
        );

        const run = store().reconcileDallETasks('message-id');
        await vi.advanceTimersByTimeAsync(3000);
        await run;
        stubs.restore();

        expect(createTaskMock).not.toHaveBeenCalled();
        const parsed = JSON.parse(originContent()) as {
          imageId?: string;
          taskAttempt?: number;
          taskId?: string;
        }[];
        expect(parsed[0]?.imageId).toBe('file-from-live-alias');
        expect(parsed[0]?.taskAttempt).toBe(3);
        expect(parsed[0]?.taskId).toBe(successId);
      },
    );

    it('surfaces a 401 from every same-attempt alias so the tile keeps Retry', async () => {
      const probes = probeIdsForAttempt(3);
      expect(probes.length).toBeGreaterThanOrEqual(1);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'processing',
        taskAttempt: 3,
        taskId: probes[0]?.taskId,
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockRejectedValue(
        Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } }),
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toBe(JSON.stringify([{ prompt: 'p1' }]));
      const errorArg = stubs.pluginStateSpy.mock.calls[0]?.[1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({ message: 'UNAUTHORIZED', status: 401 });
    });

    it('surfaces a 503 from every same-attempt alias so the tile keeps Retry', async () => {
      const probes = probeIdsForAttempt(3);
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'processing',
        taskAttempt: 3,
        taskId: probes[0]?.taskId,
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockRejectedValue(
        Object.assign(new Error('slot unavailable'), { data: { httpStatus: 503 } }),
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      const errorArg = stubs.pluginStateSpy.mock.calls[0]?.[1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({ message: 'slot unavailable', status: 503 });
      const parsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(parsed[0]?.imageId).toBeUndefined();
    });

    it('surfaces an active-alias poll timeout so the tile keeps Retry', async () => {
      vi.useFakeTimers();
      const probes = probeIdsForAttempt(3);
      const liveId = probes[0]?.taskId as string;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'processing',
        taskAttempt: 3,
        taskId: liveId,
      });
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === liveId) return { status: 'processing' };
        return { status: 'task_missing' };
      });

      const run = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(301_000);
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      const errorArg = stubs.pluginStateSpy.mock.calls[0]?.[1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({
        message: 'Image generation timed out while waiting for the task result.',
      });
    });

    it('attaches a delayed success over an early 401 on another same-attempt alias', async () => {
      vi.useFakeTimers();
      const probes = probeIdsForAttempt(3);
      expect(probes.length).toBeGreaterThanOrEqual(2);
      const unauthorizedId = probes[0]?.taskId as string;
      const successId = probes[1]?.taskId as string;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockResolvedValue({
        status: 'processing',
        taskAttempt: 3,
        taskId: unauthorizedId,
      });
      let successPolls = 0;
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === unauthorizedId) {
          throw Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } });
        }
        if (taskId === successId) {
          successPolls += 1;
          if (successPolls === 1) return { status: 'processing' };
          return { file: { id: 'file-from-live-alias' }, status: 'success' };
        }
        return { status: 'task_missing' };
      });

      const run = store().reconcileDallETasks('message-id');
      await vi.advanceTimersByTimeAsync(3000);
      await run;
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as {
        imageId?: string;
        taskAttempt?: number;
        taskId?: string;
      }[];
      expect(parsed[0]?.imageId).toBe('file-from-live-alias');
      expect(parsed[0]?.taskAttempt).toBe(3);
      expect(parsed[0]?.taskId).toBe(successId);
    });

    it('adopts a messages_files link without probing when content is prompt-only', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]), 'message-id', {
        imageList: [{ alt: 'p1', id: 'file-linked', url: '' }],
      });
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi.spyOn(imageGenerationService, 'getChatImageResult');

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-linked');
    });

    it('does not persist a compact imageList onto the first prompt', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'a' }, { prompt: 'b' }]), 'message-id', {
        imageList: [{ alt: 'b', id: 'file-b', url: '' }],
      });
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi
        .spyOn(imageGenerationService, 'getChatImageResult')
        .mockResolvedValue({ status: 'task_missing' });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string }[];
      expect(parsed[0]?.imageId).toBeUndefined();
      expect(parsed[1]?.imageId).toBeUndefined();
    });

    it('attaches slot files by prompt index rather than imageList order', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'a' }, { prompt: 'b' }]), 'message-id', {
        imageList: [
          { alt: 'b', id: 'file-b', url: '' },
          { alt: 'a', id: 'file-a', url: '' },
        ],
      });
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      const pollMock = vi.spyOn(imageGenerationService, 'getChatImageResult');
      vi.spyOn(imageGenerationService, 'getChatImageSlotResult').mockImplementation(
        async ({ index }) =>
          index === 0
            ? { file: { id: 'file-a' }, status: 'success', taskAttempt: 0, taskId: 'task-a' }
            : { file: { id: 'file-b' }, status: 'success', taskAttempt: 0, taskId: 'task-b' },
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(pollMock).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-a');
      expect(parsed[0]?.taskId).toBe('task-a');
      expect(parsed[1]?.imageId).toBe('file-b');
      expect(parsed[1]?.taskId).toBe('task-b');
    });

    it('adopts a successful alias when an earlier legacy scope is terminal', async () => {
      const probes = promptOnlyProbeIds();
      expect(probes.length).toBeGreaterThanOrEqual(2);
      const terminalId = probes[0]?.taskId;
      const successId = probes[1]?.taskId;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === successId)
          return { file: { id: 'file-from-other-scope' }, status: 'success' };
        if (taskId === terminalId) {
          return {
            error: { body: { detail: 'stopped' }, name: 'ImageGenerationError' },
            status: 'error',
          };
        }
        return { status: 'task_missing' };
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-from-other-scope');
      expect(parsed[0]?.taskId).toBe(successId);
    });

    it('adopts a successful first alias even when a later scope is terminal', async () => {
      const probes = promptOnlyProbeIds();
      expect(probes.length).toBeGreaterThanOrEqual(2);
      const successId = probes[0]?.taskId;
      const terminalId = probes[1]?.taskId;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === successId)
          return { file: { id: 'file-from-first-scope' }, status: 'success' };
        if (taskId === terminalId) {
          return {
            error: { body: { detail: 'expired' }, name: 'ImageGenerationError' },
            status: 'error',
          };
        }
        return { status: 'task_missing' };
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-from-first-scope');
      expect(parsed[0]?.taskId).toBe(successId);
    });

    it('surfaces a permanent alias lookup error so prompt-only tiles keep Retry', async () => {
      const probes = promptOnlyProbeIds();
      expect(probes.length).toBeGreaterThanOrEqual(2);
      const unauthorizedId = probes[0]?.taskId;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === unauthorizedId) {
          throw Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } });
        }
        return { status: 'task_missing' };
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toBe(JSON.stringify([{ prompt: 'p1' }]));
      // pluginState.error[index] is what Item/Error.tsx reads; without it the
      // Prompt card has no Retry button
      const errorArg = stubs.pluginStateSpy.mock.calls[0]?.[1] as { error: unknown[] };
      expect(errorArg.error[0]).toMatchObject({ message: 'UNAUTHORIZED', status: 401 });
    });

    it('still adopts a successful alias when another scope returns a permanent 401', async () => {
      const probes = promptOnlyProbeIds();
      expect(probes.length).toBeGreaterThanOrEqual(2);
      const unauthorizedId = probes[0]?.taskId;
      const successId = probes[1]?.taskId;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => {
        if (taskId === successId)
          return { file: { id: 'file-from-other-scope' }, status: 'success' };
        if (taskId === unauthorizedId) {
          throw Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401 } });
        }
        return { status: 'task_missing' };
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      const parsed = JSON.parse(originContent()) as { imageId?: string; taskId?: string }[];
      expect(parsed[0]?.imageId).toBe('file-from-other-scope');
      expect(parsed[0]?.taskId).toBe(successId);
    });

    it('does not auto-create when prompt-only tiles have no matching task row', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(originContent()).toBe(JSON.stringify([{ prompt: 'p1' }]));
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

    it('a legacy persisted id without taskFence does not auto-create', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: initialIdFor(0) }]));
      const stubs = installStoreStubs();
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('remount create joins the persisted send span when the deferred lane is gone', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(
        JSON.stringify([
          {
            prompt: 'p1',
            spanId: 'gd_0123456789abcdef',
            taskFence: 0,
            taskId: validId,
          },
        ]),
      );
      useChatStore.setState({ deferredBrowserGenerationLanes: {} });
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
          ? { file: { id: 'file-span' }, status: 'success' }
          : { status: 'task_missing' },
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ spanId: 'gd_0123456789abcdef', taskId: validId }),
      );
    });

    it('a later generation after a prior Stop still recovers on reload', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskFence: 1, taskId: validId }]));
      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
        deferredBrowserGenerationLanes: {},
      });
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
          ? { file: { id: 'file-recover' }, status: 'success' }
          : { status: 'task_missing' },
      );

      await store().reconcileDallETasks('message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: validId }));
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
      expect(originContent()).toContain('"imageId":"file-recover"');
    });

    it('Stop-marked tiles stay cancelled after a reload zeros the in-memory fence', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]),
        'message-id',
        {
          plugin: {
            apiName: 'text2image',
            arguments: '{}',
            identifier: 'lobe-image-designer',
            type: 'builtin',
          },
        },
      );
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      const stubs = installStoreStubs();
      await store().cancelPreparedChatImageTasks(ORIGIN_SESSION, undefined, null);
      stubs.restore();
      expect(originContent()).toContain('"taskCancelled":true');

      useChatStore.setState({
        conversationClearGeneration: 0,
        conversationScopedClearGenerations: {},
      });
      const createTaskMock = vi.spyOn(imageGenerationService, 'createChatImageTask');
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        status: 'task_missing',
      });
      const stubs2 = installStoreStubs();
      await store().reconcileDallETasks('message-id');
      stubs2.restore();

      expect(createTaskMock).not.toHaveBeenCalled();
      expect(stubs2.pluginStateSpy).toHaveBeenCalledWith('message-id', {
        error: [{ errorType: 'ChatImageTaskCancelled' }],
      });
    });

    it('does not cancel an explicit non-image tool that happens to look like a prompt array', async () => {
      const derivedId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskId: derivedId }]), 'message-id', {
        plugin: {
          apiName: 'plan',
          arguments: '{}',
          identifier: 'task-planner',
          type: 'plugin',
        },
        role: 'tool',
      });
      const stubs = installStoreStubs();
      const cancelSpy = vi.spyOn(imageGenerationService, 'cancelUnstartedChatImageTasks');

      await store().cancelPreparedChatImageTasks(ORIGIN_SESSION, undefined, null);
      stubs.restore();

      expect(cancelSpy).not.toHaveBeenCalled();
      expect(stoppedRegistryHas(derivedId)).toBe(false);
      expect(originContent()).not.toContain('taskCancelled');
    });

    it('Retry after a Stop-marked tile re-authorizes and may submit', async () => {
      const validId = initialIdFor(0);
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskCancelled: true, taskFence: 0, taskId: validId }]),
      );
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
          ? { file: { id: `file-${taskId}` }, status: 'success' }
          : { status: 'task_missing' },
      );

      await store().retryDallEImages('message-id');
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: validId }));
      expect(originContent()).toContain(`"imageId":"file-${validId}"`);
      expect(originContent()).not.toContain('"taskCancelled":true');
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
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]));
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
      seedToolMessage(
        JSON.stringify([{ prompt: 'p1', taskAttempt: 9, taskFence: 0, taskId: attempt9 }]),
      );
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
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]));
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

    it('a readiness flip inside the FINAL poll interval is consumed by the owning run (R17-1)', async () => {
      vi.useFakeTimers();
      const validId = initialIdFor(0);
      seedToolMessage(JSON.stringify([{ prompt: 'p1', taskFence: 0, taskId: validId }]));
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
          ? { file: { id: 'file-final' }, status: 'success' }
          : { status: 'task_missing' },
      );

      const first = store().reconcileDallETasks('message-id');
      // the last IN-window readiness check runs at 29.5 s and starts the
      // final 500 ms sleep
      await vi.advanceTimersByTimeAsync(29_600);
      // readiness flips INSIDE that closing interval; the renderer effect
      // fires a second invocation which finds the key still owned and returns
      mockImageState.isInit = true;
      const second = store().reconcileDallETasks('message-id');
      await second;
      expect(createTaskMock).not.toHaveBeenCalled();

      // the owner crosses the deadline, re-checks readiness ONCE more, and
      // completes the recovery itself — no third transition, no remount, no
      // explicit Retry exists to save it otherwise
      await vi.advanceTimersByTimeAsync(6000);
      await first;
      stubs.restore();

      expect(createTaskMock).toHaveBeenCalledTimes(1);
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: validId }));
      expect(originContent()).toContain('"imageId":"file-final"');
      expect(stubs.pluginStateSpy).not.toHaveBeenCalled();
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
          conversationNavigationGeneration: 0,
          conversationScopedClearGenerations: {},
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
        expect.objectContaining({
          conversationContext: expect.objectContaining({ sessionId: ORIGIN_SESSION }),
          imageList: [{ alt: 'test prompt', id: 'new-id', url: '' }],
          skipRefresh: true,
        }),
      );
    });

    it('writes into the originating map after the visible topic changed', async () => {
      seedToolMessage(
        JSON.stringify([{ imageId: 'old-id', previewUrl: 'old-url', prompt: 'test prompt' }]),
      );
      useChatStore.setState({
        activeId: 'other-session',
        activeTopicId: 'other-topic',
      });
      const stubs = installStoreStubs();

      await store().updateImageItem('message-id', (draft: any) => {
        draft[0].imageId = 'new-id';
      });
      stubs.restore();

      expect(originContent()).toContain('"imageId":"new-id"');
    });
  });

  describe('text2image', () => {
    it('returns a completed invocation so invokeBuiltinTool does not treat success as skipped', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockImplementation(async (taskId) => ({
        file: { id: `file-${taskId}` },
        status: 'success',
      }));

      const result = await store().text2image('message-id', [{ prompt: 'p1' }] as DallEImageItem[]);
      stubs.restore();

      expect(result).toEqual({
        data: [{ prompt: 'p1' }],
        outcome: 'completed',
        shouldContinue: true,
      });
    });

    it('returns failed and does not continue when no image model is configured', async () => {
      mockImageState.isInit = false;
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();

      const result = await store().text2image('message-id', [{ prompt: 'p1' }] as DallEImageItem[]);
      stubs.restore();

      expect(result).toEqual({
        data: [{ prompt: 'p1' }],
        outcome: 'failed',
        shouldContinue: false,
      });
    });

    it('returns persistence_failed when the task id write cannot be proven', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      useChatStore.setState({
        internal_updateMessageContent: vi.fn(async () => ({ persistenceAmbiguous: false })),
      });

      const result = await store().text2image('message-id', [{ prompt: 'p1' }] as DallEImageItem[]);
      stubs.restore();

      expect(result).toEqual({
        data: [{ prompt: 'p1' }],
        outcome: 'persistence_failed',
        shouldContinue: false,
      });
    });

    it('returns cancelled when Stop fences the write-first persist', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      let releasePersist!: () => void;
      const persistGate = new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      const stubs = installStoreStubs({ persistGate });
      vi.spyOn(imageGenerationService, 'createChatImageTask');

      const run = store().text2image('message-id', [{ prompt: 'p1' }] as DallEImageItem[]);
      useChatStore.setState((s) => ({
        ...bumpLaneScopedClearGeneration(s, ORIGIN_SESSION, undefined, null),
      }));
      releasePersist();
      const result = await run;
      stubs.restore();

      expect(result).toEqual({
        data: undefined,
        outcome: 'cancelled',
        shouldContinue: false,
      });
    });

    it('returns failed after a terminal provider error', async () => {
      seedToolMessage(JSON.stringify([{ prompt: 'p1' }]));
      const stubs = installStoreStubs();
      vi.spyOn(imageGenerationService, 'createChatImageTask').mockImplementation(
        async ({ taskId }) => ({ taskId: taskId! }),
      );
      vi.spyOn(imageGenerationService, 'getChatImageResult').mockResolvedValue({
        error: { body: { detail: 'upstream 503' }, name: 'ServerError' },
        status: 'error',
      });

      const result = await store().text2image('message-id', [{ prompt: 'p1' }] as DallEImageItem[]);
      stubs.restore();

      expect(result).toEqual({
        data: [{ prompt: 'p1' }],
        outcome: 'failed',
        shouldContinue: false,
      });
    });
  });
});
