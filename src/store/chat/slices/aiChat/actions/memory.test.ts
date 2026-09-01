import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { getLatestReportedInputTokens, nextReportedInputTokenFloorAfterMessageId } from '@/helpers/reportedContextTokens';
import * as compactionDebugClient from '@/libs/logger/compactionDebugClient';
import { chatService } from '@/services/chat';
import {
  conversationGenerationService,
  tryEnqueueConversationGeneration,
} from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

const durableMocks = vi.hoisted(() => ({ enabled: false }));

vi.mock('@/helpers/estimateContextUsageAsync', () => ({
  estimateContextUsageAsync: vi.fn(),
}));
vi.mock('@/helpers/modelContextWindowTokens', () => ({
  getModelContextWindowTokens: vi.fn(() => 1000),
}));
vi.mock('@/services/chat', () => ({
  chatService: { fetchPresetTaskResult: vi.fn() },
}));
vi.mock('@/helpers/durableConversationGeneration', () => ({
  isClientDurableConversationGenerationEnabled: vi.fn(() => durableMocks.enabled),
}));
vi.mock('@/services/conversationGeneration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/conversationGeneration')>();
  return {
    ...actual,
    conversationGenerationService: {
      cancel: vi.fn(async () => ({})),
      listActive: vi.fn(async () => []),
    },
    tryEnqueueConversationGeneration: vi.fn(),
  };
});
vi.mock('@/services/message', () => ({
  messageService: {
    getConversationVersion: vi.fn(),
    removeMessage: vi.fn(),
    removeMessages: vi.fn(),
    removeMessagesByAssistant: vi.fn(),
    updateMessage: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    mergeReportedInputTokenFloorWatermark: vi.fn(),
    persistMemoryCompaction: vi.fn(),
    removeTopic: vi.fn(),
    updateTopic: vi.fn(),
  },
}));
vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: vi.fn(async (text: string) => text.length),
}));

const SESSION_ID = 'session-1';
const TOPIC_ID = 'topic-1';

const message = (id: string, role: UIChatMessage['role'], content = id): UIChatMessage =>
  ({ content, id, role, updatedAt: 1 }) as UIChatMessage;

const messages = [
  message('u1', 'user'),
  message('a1', 'assistant'),
  message('u2', 'user'),
  message('a2', 'assistant'),
  message('u3', 'user'),
  message('a3', 'assistant'),
];

const setConversation = (overrides: Record<string, unknown> = {}) => {
  useChatStore.setState(
    {
      activeId: SESSION_ID,
      activeSessionType: undefined,
      activeThreadId: undefined,
      activeTopicId: TOPIC_ID,
      chatLoadingIds: [],
      conversationClearGeneration: 0,
      conversationScopedClearGenerations: {},
      memoryCompactionInvalidationGeneration: 0,
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: messages },
      portalThreadId: undefined,
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            id: TOPIC_ID,
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
      ...overrides,
    },
    false,
  );
};

describe('chat memory actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    durableMocks.enabled = false;
    vi.mocked(messageService.getConversationVersion).mockResolvedValue(7);
    useUserStore.setState({ ownershipInvalidationGeneration: 0 });
    vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
      contextCompactThreshold: 0.8,
      enableCompressHistory: true,
      enableHistoryCount: true,
      enableTokenThresholdAutoCompact: true,
      historyCount: 4,
    });
    vi.spyOn(agentChatConfigSelectors, 'enableHistoryCount').mockReturnValue(true);
    vi.spyOn(agentChatConfigSelectors, 'historyCount').mockReturnValue(4);
    vi.spyOn(agentSelectors, 'currentAgentConfig').mockReturnValue({
      model: 'active-model',
      provider: 'active-provider',
    } as any);
    vi.spyOn(systemAgentSelectors, 'historyCompress').mockReturnValue({
      model: 'summary-model',
      provider: 'summary-provider',
    });
    vi.mocked(estimateContextUsageAsync)
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: messages,
        historySummaryToken: 0,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 800,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: messages.slice(2),
        historySummaryToken: 2,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 600,
      });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await onFinish?.('updated cumulative summary', {} as any);
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);
    vi.mocked(topicService.persistMemoryCompaction).mockImplementation(async (_id, params) => ({
      accepted: true,
      metadata: params.metadata,
    }));
    vi.mocked(topicService.mergeReportedInputTokenFloorWatermark).mockImplementation(async (id) => {
      const state = useChatStore.getState();
      const topic = topicSelectors.getTopicInContainer(state.activeId, id)(state);
      if (!topic) return undefined;
      const stored = topic.metadata?.reportedInputTokenFloorAfterMessageId;
      const nextId = nextReportedInputTokenFloorAfterMessageId({
        cursorId: topic.metadata?.historySummaryLastMessageId,
        storedAfterMessageId: stored,
        topicMessages: chatSelectors.mainTopicAIChats(state),
      });
      return {
        historySummary: topic.historySummary,
        historySummaryLastMessageId: topic.metadata?.historySummaryLastMessageId,
        reportedInputTokenFloorAfterMessageId: nextId,
        updated: nextId !== stored,
      };
    });
    setConversation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compacts only settled turns and persists the cursor with one topic write', async () => {
    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({
      messageCountIncluded: 4,
      status: 'compacted',
    });
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chatService.fetchPresetTaskResult).mock.calls[0][0].params).not.toHaveProperty(
      'reasoning_effort',
    );
    expect(vi.mocked(chatService.fetchPresetTaskResult).mock.calls[0][0].params).toMatchObject({
      max_tokens: 2648,
      model: 'summary-model',
      provider: 'summary-provider',
    });
    expect(vi.mocked(chatService.fetchPresetTaskResult).mock.calls[0][0].params.messages[0].content).toContain(
      'limited to 600 tokens',
    );
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledTimes(1);
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        historySummary: 'updated cumulative summary',
        metadata: expect.objectContaining({ historySummaryLastMessageId: 'a2' }),
      }),
    );
  });

  it('persists a floor watermark on the remaining protected assistant', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
      { ...message('a3', 'assistant'), metadata: { totalInputTokens: 1_048_570 } },
    ];
    setConversation({
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: topicMessages },
    });

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ status: 'compacted' });
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          historySummaryLastMessageId: 'a2',
          reportedInputTokenFloorAfterMessageId: 'a3',
        }),
      }),
    );
    expect(vi.mocked(estimateContextUsageAsync).mock.calls.at(-1)?.[0].overrides).toMatchObject({
      historySummaryLastMessageId: 'a2',
      reportedInputTokenFloorAfterMessageId: 'a3',
    });
  });

  it('gives History Compress thinking models extra output budget and lowest GPT-5 effort', async () => {
    vi.spyOn(systemAgentSelectors, 'historyCompress').mockReturnValue({
      model: 'gpt-5-mini',
      provider: 'openai',
    });

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ status: 'compacted' });
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          max_tokens: 2648,
          model: 'gpt-5-mini',
          provider: 'openai',
          reasoning_effort: 'minimal',
        }),
      }),
    );
  });

  it.each([
    ['minimal', 400, 2448],
    ['balanced', 600, 2648],
    ['rich', 800, 2848],
  ] as const)(
    'embeds the %s summary cap in the client prompt and completion budget',
    async (level, summaryCap, maxTokens) => {
      vi.spyOn(agentChatConfigSelectors, 'assistanceLevel').mockReturnValue(level);
      vi.spyOn(systemAgentSelectors, 'historyCompress').mockReturnValue({
        model: 'gpt-5-mini',
        provider: 'openai',
      });

      await useChatStore.getState().triggerManualMemoryCompaction();

      const params = vi.mocked(chatService.fetchPresetTaskResult).mock.calls[0][0].params as {
        max_tokens?: number;
        messages: Array<{ content: string }>;
      };
      expect(params.messages[0].content).toContain(`limited to ${summaryCap} tokens`);
      expect(params.max_tokens).toBe(maxTokens);
    },
  );

  it('surfaces durable enqueue of a terminal failed compaction as failed', async () => {
    durableMocks.enabled = true;
    vi.mocked(tryEnqueueConversationGeneration).mockResolvedValue({
      attempt: 1,
      config: { model: 'summary-model', provider: 'summary-provider' },
      id: 'operation-failed',
      kind: 'memory_compaction',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 1,
      status: 'failed',
      topicId: TOPIC_ID,
      userId: 'user-1',
    });
    const attach = vi
      .spyOn(useChatStore.getState(), 'attachConversationGeneration')
      .mockImplementation(vi.fn());

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ reason: 'durable_enqueue_failed', status: 'failed' });
    expect(attach).not.toHaveBeenCalled();
  });

  it('enqueues the planned compaction snapshot with version and invalidation guards', async () => {
    durableMocks.enabled = true;
    vi.mocked(tryEnqueueConversationGeneration).mockResolvedValue({
      attempt: 0,
      config: { model: 'summary-model', provider: 'summary-provider' },
      id: 'operation-1',
      kind: 'memory_compaction',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: TOPIC_ID,
      userId: 'user-1',
    });
    const hashSpy = vi.spyOn(compactionDebugClient, 'hashCompactionDebugClientValue');
    const spanSpy = vi.spyOn(compactionDebugClient, 'createCompactionDebugSpanId');
    const attach = vi
      .spyOn(useChatStore.getState(), 'attachConversationGeneration')
      .mockImplementation(vi.fn());

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toEqual({ reason: 'durable_enqueued', status: 'enqueued' });
    expect(tryEnqueueConversationGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          compaction: expect.objectContaining({
            candidateMessageIds: ['u1', 'a1', 'u2', 'a2'],
            expectedFingerprint: expect.any(String),
            expectedHistorySummary: '',
            summarizerContextWindow: 1000,
            trigger: 'manual',
          }),
        }),
        conversationVersion: 7,
        expectedConversationVersion: 7,
        kind: 'memory_compaction',
        replaceActive: true,
      }),
    );
    expect(vi.mocked(tryEnqueueConversationGeneration).mock.calls[0][0].debugSpanId).toBeUndefined();
    expect(
      vi.mocked(tryEnqueueConversationGeneration).mock.calls[0][0].config.compaction?.debugSpanId,
    ).toBeUndefined();
    expect(hashSpy).not.toHaveBeenCalled();
    expect(spanSpy).not.toHaveBeenCalled();
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalled();
  });

  it('persists the same debug span on enqueue when compaction debug is enabled', async () => {
    durableMocks.enabled = true;
    vi.spyOn(compactionDebugClient, 'isCompactionDebugClientEnabled').mockReturnValue(true);
    vi.spyOn(compactionDebugClient, 'createCompactionDebugSpanId').mockReturnValue(
      'cd_0123456789abcdef',
    );
    const logSpy = vi.spyOn(compactionDebugClient, 'logCompactionDebugClientSafe');
    vi.mocked(tryEnqueueConversationGeneration).mockResolvedValue({
      attempt: 0,
      config: { model: 'summary-model', provider: 'summary-provider' },
      id: 'operation-1',
      kind: 'memory_compaction',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: TOPIC_ID,
      userId: 'user-1',
    });
    vi.spyOn(useChatStore.getState(), 'attachConversationGeneration').mockImplementation(vi.fn());

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toEqual({ reason: 'durable_enqueued', status: 'enqueued' });
    const payload = vi.mocked(tryEnqueueConversationGeneration).mock.calls[0][0];
    expect(payload.debugSpanId).toBe('cd_0123456789abcdef');
    expect(payload.config.compaction?.debugSpanId).toBe('cd_0123456789abcdef');
    expect(logSpy).toHaveBeenCalledWith(
      'planner_settled',
      expect.objectContaining({
        path: 'durable_enqueued',
        spanId: 'cd_0123456789abcdef',
      }),
    );
  });

  it('never enqueues when a destructive clear lands during the version lookup', async () => {
    durableMocks.enabled = true;
    let resolveVersion!: (version: number) => void;
    vi.mocked(messageService.getConversationVersion).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'switchTopic').mockImplementation(() => {});

    const compactionPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(messageService.getConversationVersion).toHaveBeenCalled();
    });

    // The destructive snapshot happens while the version lookup is pending:
    // the compaction key is not registered yet, so only the post-await stale
    // check can prevent the enqueue.
    await useChatStore.getState().clearMessage();
    resolveVersion(7);
    const result = await compactionPromise;

    expect(result).toEqual({ reason: 'stale_request', status: 'ineligible' });
    expect(tryEnqueueConversationGeneration).not.toHaveBeenCalled();
    expect(useChatStore.getState().durableInFlightEnqueues).toEqual({});
  });

  it('cancels the late operation when a destructive clear lands during the enqueue await', async () => {
    durableMocks.enabled = true;
    let resolveEnqueue!: (operation: unknown) => void;
    vi.mocked(tryEnqueueConversationGeneration).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnqueue = resolve;
        }),
    );
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'switchTopic').mockImplementation(() => {});
    const attach = vi
      .spyOn(useChatStore.getState(), 'attachConversationGeneration')
      .mockImplementation(vi.fn());

    const compactionPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(tryEnqueueConversationGeneration).toHaveBeenCalled();
    });

    // The clear tombstone collects the tracked in-flight key; when the enqueue
    // resolves afterwards, the stale path must cancel the orphaned operation.
    await useChatStore.getState().clearMessage();
    resolveEnqueue({
      attempt: 0,
      config: { model: 'summary-model', provider: 'summary-provider' },
      id: 'operation-late',
      kind: 'memory_compaction',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: TOPIC_ID,
      userId: 'user-1',
    });
    const result = await compactionPromise;

    expect(result).toEqual({ reason: 'stale_request', status: 'ineligible' });
    expect(conversationGenerationService.cancel).toHaveBeenCalledWith('operation-late');
    expect(attach).not.toHaveBeenCalled();
    expect(useChatStore.getState().durableInFlightEnqueues).toEqual({});
  });

  it('never enqueues when the active topic is deleted during the version lookup', async () => {
    durableMocks.enabled = true;
    let resolveVersion!: (version: number) => void;
    vi.mocked(messageService.getConversationVersion).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    // Keep the active topic id unchanged so only the topic-scoped tombstone can
    // reject the enqueue (the global clear epoch is not bumped by removeTopic).
    vi.spyOn(useChatStore.getState(), 'switchTopic').mockImplementation(() => {});

    const compactionPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(messageService.getConversationVersion).toHaveBeenCalled();
    });

    const removePromise = useChatStore.getState().removeTopic(TOPIC_ID);
    resolveVersion(7);
    const result = await compactionPromise;
    await removePromise;

    expect(result).toEqual({ reason: 'stale_request', status: 'ineligible' });
    expect(tryEnqueueConversationGeneration).not.toHaveBeenCalled();
    expect(useChatStore.getState().durableInFlightEnqueues).toEqual({});
  });

  it('cancels the late operation when the active topic is deleted during the enqueue await', async () => {
    durableMocks.enabled = true;
    let resolveEnqueue!: (operation: unknown) => void;
    vi.mocked(tryEnqueueConversationGeneration).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnqueue = resolve;
        }),
    );
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'switchTopic').mockImplementation(() => {});
    const attach = vi
      .spyOn(useChatStore.getState(), 'attachConversationGeneration')
      .mockImplementation(vi.fn());

    const compactionPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(tryEnqueueConversationGeneration).toHaveBeenCalled();
    });

    // The topic tombstone collects the tracked in-flight key; when the enqueue
    // resolves afterwards, the stale path must cancel the orphaned operation.
    const removePromise = useChatStore.getState().removeTopic(TOPIC_ID);
    resolveEnqueue({
      attempt: 0,
      config: { model: 'summary-model', provider: 'summary-provider' },
      id: 'operation-late',
      kind: 'memory_compaction',
      lane: 'lane-1',
      laneGeneration: 1,
      revision: 0,
      status: 'pending',
      topicId: TOPIC_ID,
      userId: 'user-1',
    });
    const result = await compactionPromise;
    await removePromise;

    expect(result).toEqual({ reason: 'stale_request', status: 'ineligible' });
    expect(conversationGenerationService.cancel).toHaveBeenCalledWith('operation-late');
    expect(attach).not.toHaveBeenCalled();
    expect(useChatStore.getState().durableInFlightEnqueues).toEqual({});
  });

  it('does not compact below the configured high watermark', async () => {
    vi.spyOn(compactionDebugClient, 'isCompactionDebugClientEnabled').mockReturnValue(true);
    const logSpy = vi.spyOn(compactionDebugClient, 'logCompactionDebugClientSafe');
    vi.mocked(estimateContextUsageAsync).mockReset().mockResolvedValue({
      chatsToken: 6,
      contextMessages: messages,
      historySummaryToken: 0,
      inputToken: 1,
      memoryToken: 2,
      systemRoleToken: 3,
      toolsToken: 4,
      totalToken: 799,
    });

    const result = await useChatStore.getState().triggerTokenThresholdMemoryCompaction();

    expect(result).toEqual({
      estimatedTokensBefore: 799,
      highWatermark: 0.8,
      lowWatermark: 0.6,
      reason: 'below_high_watermark',
      status: 'not_needed',
    });
    expect(getModelContextWindowTokens).toHaveBeenCalledWith('active-model', 'active-provider');
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'planner_settled',
      expect.objectContaining({
        chatsToken: 6,
        inputToken: 1,
        maxTokens: 1000,
        memoryToken: 2,
        model: 'active-model',
        path: 'client_inline',
        provider: 'active-provider',
        ratio: 0.799,
        reason: 'below_high_watermark',
        status: 'not_needed',
        systemRoleToken: 3,
        toolsToken: 4,
        totalToken: 799,
        trigger: 'token_threshold',
      }),
    );
  });

  it('reports when protected context cannot reach the low watermark', async () => {
    vi.mocked(estimateContextUsageAsync)
      .mockReset()
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: messages,
        historySummaryToken: 0,
        totalToken: 800,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: messages.slice(4),
        historySummaryToken: 2,
        totalToken: 700,
      });

    const result = await useChatStore.getState().triggerTokenThresholdMemoryCompaction();

    expect(result).toMatchObject({
      estimatedTokensAfter: 700,
      estimatedTokensBefore: 800,
      highWatermark: 0.8,
      lowWatermark: 0.6,
      reason: 'protected_context_exceeds_low_watermark',
      status: 'target_unreachable',
    });
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          memoryDebugLog: [
            expect.objectContaining({
              highWatermark: 0.8,
              lowWatermark: 0.6,
              status: 'target_unreachable',
            }),
          ],
        }),
      }),
    );
  });

  it('merges only messages after the persisted cursor into the prior summary', async () => {
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: { historySummaryLastMessageId: 'a1' },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().triggerManualMemoryCompaction();

    const request = vi.mocked(chatService.fetchPresetTaskResult).mock.calls[0][0];
    expect(request.params.messages?.[1].content).toContain(
      '<existing_summary>\nexisting summary\n</existing_summary>',
    );
    expect(request.params.messages?.[1].content).toContain('<user>u2</user>');
    expect(request.params.messages?.[1].content).not.toContain('<user>u1</user>');
  });

  it('does not overwrite the prior summary when the model returns empty output', async () => {
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await onFinish?.('   ', {} as any);
    });

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result.status).toBe('failed');
    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalled();
  });

  it('returns a failed result when the summarizer rejects', async () => {
    vi.mocked(chatService.fetchPresetTaskResult).mockRejectedValue(new Error('network failed'));

    await expect(useChatStore.getState().triggerManualMemoryCompaction()).resolves.toEqual({
      reason: 'compaction_exception',
      status: 'failed',
    });
    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalled();
  });

  it('shares one in-flight compaction job per topic', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await gate;
      await onFinish?.('shared summary', {} as any);
    });

    const manual = useChatStore.getState().triggerManualMemoryCompaction();
    const background = useChatStore.getState().triggerMessageCountMemoryCompaction();
    await vi.waitFor(() => expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1));
    release();

    const [manualResult, backgroundResult] = await Promise.all([manual, background]);
    expect(manualResult).toEqual(backgroundResult);
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledTimes(1);
  });

  it('lets an abortable caller bail out of a running job without cancelling it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await gate;
      await onFinish?.('shared summary', {} as any);
    });

    // a job started without a controller (e.g. the auto-compact watcher)
    const background = useChatStore.getState().triggerMessageCountMemoryCompaction();
    await vi.waitFor(() => expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1));

    // a pre-send caller joins the same job with its own controller and then aborts
    const controller = new AbortController();
    const joined = useChatStore.getState().triggerTokenThresholdMemoryCompaction(controller);
    controller.abort();

    await expect(joined).resolves.toEqual({ reason: 'aborted', status: 'ineligible' });
    // the background job is untouched and still completes with its single topic write
    release();
    await background;
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledTimes(1);
  });

  it('caps pre-send token compaction at three batches without advancing the cursor past them', async () => {
    // 85 user/assistant pairs → 168 eligible messages → batches of 40/40/40/40/8
    const longMessages = Array.from({ length: 170 }, (_, i) =>
      message(
        i % 2 === 0 ? `u${i / 2 + 1}` : `a${(i - 1) / 2 + 1}`,
        i % 2 === 0 ? 'user' : 'assistant',
      ),
    );
    setConversation({ messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: longMessages } });
    vi.mocked(estimateContextUsageAsync)
      .mockReset()
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: longMessages,
        historySummaryToken: 0,
        totalToken: 800,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: longMessages.slice(120),
        historySummaryToken: 2,
        totalToken: 700,
      });

    const result = await useChatStore
      .getState()
      .triggerTokenThresholdMemoryCompaction(new AbortController());

    expect(result).toMatchObject({ messageCountIncluded: 120, status: 'compacted' });
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(3);
    // the cursor must stop at the end of batch 3 (messages[119]), not the last candidate
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({ historySummaryLastMessageId: 'a60' }),
      }),
    );

    // a follow-up run resumes from the capped cursor and summarizes the remaining batches
    vi.mocked(estimateContextUsageAsync)
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: longMessages.slice(120),
        historySummaryToken: 2,
        totalToken: 800,
      })
      .mockResolvedValueOnce({
        chatsToken: 2,
        contextMessages: longMessages.slice(168),
        historySummaryToken: 2,
        totalToken: 500,
      });

    const followUp = await useChatStore
      .getState()
      .triggerTokenThresholdMemoryCompaction(new AbortController());

    expect(followUp).toMatchObject({ messageCountIncluded: 48, status: 'compacted' });
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(5);
    const followUpRequest = vi.mocked(chatService.fetchPresetTaskResult).mock.calls[3][0];
    expect(followUpRequest.params.messages?.[1].content).toContain('<user>u61</user>');
    expect(followUpRequest.params.messages?.[1].content).not.toContain('<user>u60</user>');
    expect(vi.mocked(topicService.persistMemoryCompaction).mock.calls.at(-1)?.[1]).toMatchObject({
      metadata: expect.objectContaining({ historySummaryLastMessageId: 'a84' }),
    });
  });

  it('caps pre-send token compaction on complete-turn boundaries, soft-stubbing oversized turns', async () => {
    const bulky = (id: string, role: UIChatMessage['role']) =>
      message(id, role, '汉'.repeat(4000));
    const bulkyTurns = Array.from({ length: 5 }, (_, index) => [
      bulky(`bu${index + 1}`, 'user'),
      bulky(`ba${index + 1}`, 'assistant'),
    ]).flat();
    setConversation({ messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: bulkyTurns } });
    vi.mocked(estimateContextUsageAsync)
      .mockReset()
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: bulkyTurns,
        historySummaryToken: 0,
        totalToken: 1_000_000,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: bulkyTurns.slice(6),
        historySummaryToken: 2,
        totalToken: 700,
      });

    const result = await useChatStore
      .getState()
      .triggerTokenThresholdMemoryCompaction(new AbortController());

    expect(result).toMatchObject({ messageCountIncluded: 6, status: 'compacted' });
    // Oversized complete turns are stubbed locally — no History Compress API calls.
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        historySummary: expect.stringContaining('oversized message'),
        metadata: expect.objectContaining({ historySummaryLastMessageId: 'ba3' }),
      }),
    );
  });

  it('undoes a summary write that raced an invalidation', async () => {
    vi.mocked(topicService.persistMemoryCompaction).mockReset();
    vi.mocked(topicService.updateTopic).mockReset();
    vi.mocked(topicService.persistMemoryCompaction).mockImplementationOnce(async (_id, params) => {
      useChatStore.setState((s) => ({
        memoryCompactionInvalidationGeneration: s.memoryCompactionInvalidationGeneration + 1,
      }));
      return { accepted: true, metadata: params.metadata };
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ reason: 'conversation_changed', status: 'ineligible' });
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledTimes(1);
    expect(topicService.updateTopic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(topicService.updateTopic).mock.calls[0][1]).toMatchObject({
      historySummary: '',
      metadata: expect.objectContaining({
        historySummaryLastMessageId: undefined,
        memoryArchives: [],
      }),
    });
  });

  it('reports a mid-request abort as ineligible, not failed', async () => {
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ abortController }) => {
      // a user Stop lands while the summarize request is in flight; errorHandle then
      // resolves without calling onFinish or onError
      abortController?.abort();
    });

    const result = await useChatStore
      .getState()
      .triggerTokenThresholdMemoryCompaction(new AbortController());

    expect(result).toEqual({ reason: 'aborted', status: 'ineligible' });
    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalled();
  });

  it('does not persist a summary when Stop lands after the summarizer finishes', async () => {
    const controller = new AbortController();
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await onFinish?.('summary produced before cancellation', {} as any);
      controller.abort();
    });

    const result = await useChatStore.getState().triggerTokenThresholdMemoryCompaction(controller);

    expect(result).toEqual({ reason: 'aborted', status: 'ineligible' });
    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalled();
  });

  it('restores the prior summary when Stop races the persistence write', async () => {
    const controller = new AbortController();
    const previousMetadata = {
      historySummaryLastMessageId: 'a1',
      model: 'previous-model',
      provider: 'previous-provider',
    };
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'previous summary',
            id: TOPIC_ID,
            metadata: previousMetadata,
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });
    vi.mocked(topicService.persistMemoryCompaction).mockReset();
    vi.mocked(topicService.updateTopic).mockReset();
    vi.mocked(topicService.persistMemoryCompaction).mockImplementationOnce(async (_id, params) => {
      controller.abort();
      return { accepted: true, metadata: params.metadata };
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);

    const result = await useChatStore.getState().triggerTokenThresholdMemoryCompaction(controller);

    expect(result).toEqual({ reason: 'aborted', status: 'ineligible' });
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledTimes(1);
    expect(topicService.updateTopic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(topicService.updateTopic).mock.calls[0]).toEqual([
      TOPIC_ID,
      { historySummary: 'previous summary', metadata: previousMetadata },
    ]);
  });

  it('skips count estimates when no complete turn has expired', async () => {
    vi.spyOn(agentChatConfigSelectors, 'historyCount').mockReturnValue(20);

    const result = await useChatStore.getState().triggerMessageCountMemoryCompaction();

    expect(result.status).toBe('not_needed');
    expect(estimateContextUsageAsync).not.toHaveBeenCalled();
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
  });

  it('compacts on message_count even when the token ratio is below the high watermark', async () => {
    vi.spyOn(compactionDebugClient, 'isCompactionDebugClientEnabled').mockReturnValue(true);
    const logSpy = vi.spyOn(compactionDebugClient, 'logCompactionDebugClientSafe');
    vi.mocked(estimateContextUsageAsync)
      .mockReset()
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: messages,
        historySummaryToken: 0,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 200,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: messages.slice(2),
        historySummaryToken: 2,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 150,
      });

    const result = await useChatStore.getState().triggerMessageCountMemoryCompaction();

    expect(result.status).toBe('compacted');
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'planner_settled',
      expect.objectContaining({
        path: 'client_inline',
        ratio: 0.2,
        status: 'compacted',
        totalToken: 200,
        trigger: 'message_count',
      }),
    );
  });

  it('compacts an explicit conversation instead of the active topic', async () => {
    const sourceTopicId = 'source-topic';
    const otherTopicId = 'other-topic';
    setConversation({
      activeTopicId: otherTopicId,
      messagesMap: {
        [messageMapKey(SESSION_ID, sourceTopicId)]: messages,
        [messageMapKey(SESSION_ID, otherTopicId)]: [
          message('keep-u', 'user'),
          message('keep-a', 'assistant'),
        ],
      },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            id: sourceTopicId,
            title: 'Source',
            updatedAt: 1,
          },
          {
            createdAt: 1,
            historySummary: 'leave-me',
            id: otherTopicId,
            title: 'Other',
            updatedAt: 1,
          },
        ],
      },
    });

    const result = await useChatStore
      .getState()
      .triggerMessageCountMemoryCompaction(new AbortController(), {
        sessionId: SESSION_ID,
        topicId: sourceTopicId,
      });

    expect(result.status).toBe('compacted');
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      sourceTopicId,
      expect.objectContaining({ historySummary: 'updated cumulative summary' }),
    );
    expect(
      useChatStore.getState().topicMaps[SESSION_ID]?.find((topic) => topic.id === otherTopicId)
        ?.historySummary,
    ).toBe('leave-me');
  });

  it('runs message_count compaction on the pre-send path when an AbortController is provided', async () => {
    vi.spyOn(compactionDebugClient, 'isCompactionDebugClientEnabled').mockReturnValue(true);
    const logSpy = vi.spyOn(compactionDebugClient, 'logCompactionDebugClientSafe');
    vi.mocked(estimateContextUsageAsync)
      .mockReset()
      .mockResolvedValueOnce({
        chatsToken: 6,
        contextMessages: messages,
        effectiveHistoryCount: 4,
        historySummaryToken: 0,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 200,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: messages.slice(2),
        effectiveHistoryCount: 4,
        historySummaryToken: 2,
        inputToken: 0,
        memoryToken: 0,
        systemRoleToken: 0,
        toolsToken: 0,
        totalToken: 150,
      });

    const result = await useChatStore
      .getState()
      .triggerMessageCountMemoryCompaction(new AbortController());

    expect(result.status).toBe('compacted');
    expect(logSpy).toHaveBeenCalledWith(
      'planner_settled',
      expect.objectContaining({
        path: 'pre_send',
        preSendMessageCountCompact: true,
        status: 'compacted',
        trigger: 'message_count',
      }),
    );
  });

  it('suppresses compaction in group and thread contexts', async () => {
    setConversation({ activeSessionType: 'group' });
    expect((await useChatStore.getState().triggerManualMemoryCompaction()).status).toBe(
      'ineligible',
    );

    setConversation({ activeThreadId: 'thread-1' });
    expect((await useChatStore.getState().triggerManualMemoryCompaction()).status).toBe(
      'ineligible',
    );
    expect(estimateContextUsageAsync).not.toHaveBeenCalled();
  });

  it('defers compaction while an assistant turn is still generating', async () => {
    setConversation({ chatLoadingIds: ['a2'] });

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toEqual({ reason: 'generation_in_progress', status: 'ineligible' });
    expect(estimateContextUsageAsync).not.toHaveBeenCalled();
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
  });

  it('clears derived summary state when an included message changes', async () => {
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              memoryArchives: [{ at: 1, summaryExcerpt: 'existing summary' }],
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().internal_invalidateMemoryCompaction(['u1']);

    expect(topicService.updateTopic).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        historySummary: '',
        metadata: expect.objectContaining({
          historySummaryLastMessageId: undefined,
          memoryArchives: [],
          reportedInputTokenFloorAfterMessageId: undefined,
        }),
      }),
    );
  });

  it('persists a one-time migration floor watermark for compacted topics that predate the field', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
    ];
    setConversation({
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: topicMessages },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: { historySummaryLastMessageId: 'a1' },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();

    expect(topicService.mergeReportedInputTokenFloorWatermark).toHaveBeenCalledWith(TOPIC_ID);
    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });
  });

  it('does not rewrite an already-valid floor watermark', async () => {
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              reportedInputTokenFloorAfterMessageId: 'a2',
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();

    expect(topicService.mergeReportedInputTokenFloorWatermark).toHaveBeenCalledWith(TOPIC_ID);
    expect(topicService.updateTopic).not.toHaveBeenCalled();
  });

  it('rotates the floor watermark when its row is deleted without clearing the summary', async () => {
    setConversation({
      messagesMap: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: messages.filter((item) => item.id !== 'a3'),
      },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              reportedInputTokenFloorAfterMessageId: 'a3',
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();

    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });
    expect(topicService.updateTopic).not.toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({ historySummary: '' }),
    );
    expect(useChatStore.getState().memoryCompactionInvalidationGeneration).toBe(0);
  });

  it('watermarks a protected remaining user when compact leaves no assistant', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
    ];
    setConversation({
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: topicMessages },
    });

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ status: 'compacted' });
    expect(topicService.persistMemoryCompaction).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          historySummaryLastMessageId: 'a2',
          reportedInputTokenFloorAfterMessageId: 'u3',
        }),
      }),
    );
  });

  it('does not rotate the floor watermark when the protected assistant is edited', async () => {
    const topicMessages = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
      message('u3', 'user'),
      { ...message('a3', 'assistant'), metadata: { totalInputTokens: 1_048_570 } },
    ];
    setConversation({
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: topicMessages },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              reportedInputTokenFloorAfterMessageId: 'a3',
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    await useChatStore.getState().modifyMessageContent('a3', 'edited protected reply');

    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(topicService.mergeReportedInputTokenFloorWatermark).not.toHaveBeenCalled();
    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a3',
    });
    const chats = chatSelectors.mainTopicAIChats(useChatStore.getState());
    expect(chats.find((item) => item.id === 'a3')?.metadata?.totalInputTokens).toBe(1_048_570);
    expect(getLatestReportedInputTokens(chats, { afterMessageId: 'a3' })).toBeUndefined();
  });

  it('does not apply a delayed merge response over newer local compaction metadata', async () => {
    let releaseMerge: (() => void) | undefined;
    const mergeGate = new Promise<void>((resolve) => {
      releaseMerge = resolve;
    });
    vi.mocked(topicService.mergeReportedInputTokenFloorWatermark).mockImplementation(async () => {
      await mergeGate;
      return {
        historySummary: 'existing summary',
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a3',
        updated: true,
      };
    });

    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: { historySummaryLastMessageId: 'a1' },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    const ensurePromise = useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();
    await vi.waitFor(() => {
      expect(topicService.mergeReportedInputTokenFloorWatermark).toHaveBeenCalled();
    });

    useChatStore.getState().internal_dispatchTopic(
      {
        id: TOPIC_ID,
        type: 'updateTopic',
        value: {
          historySummary: 'new summary',
          metadata: {
            historySummaryLastMessageId: 'a2',
            memoryArchives: [{ at: 2, summaryExcerpt: 'new summary', trigger: 'manual' }],
            memoryDebugLog: [{ at: 2, status: 'compacted', trigger: 'manual' }],
            reportedInputTokenFloorAfterMessageId: 'a3',
          },
        },
      },
      'durableCompactionRefresh',
    );

    releaseMerge?.();
    await ensurePromise;

    expect(topicSelectors.currentActiveTopic(useChatStore.getState())).toMatchObject({
      historySummary: 'new summary',
      metadata: expect.objectContaining({
        historySummaryLastMessageId: 'a2',
        memoryArchives: [{ at: 2, summaryExcerpt: 'new summary', trigger: 'manual' }],
        memoryDebugLog: [{ at: 2, status: 'compacted', trigger: 'manual' }],
        reportedInputTokenFloorAfterMessageId: 'a3',
      }),
    });
  });

  it('keeps the cursor as the floor watermark after deleting the sole post-cursor row', async () => {
    setConversation({
      messagesMap: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: [message('u1', 'user'), message('a1', 'assistant')],
      },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              reportedInputTokenFloorAfterMessageId: 'u3',
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });

    await useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();

    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a1',
    });

    const afterFresh = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u4', 'user'),
      { ...message('a4', 'assistant'), metadata: { totalInputTokens: 700_000 } },
    ];
    setConversation({
      messagesMap: { [messageMapKey(SESSION_ID, TOPIC_ID)]: afterFresh },
      topicMaps: useChatStore.getState().topicMaps,
    });

    await useChatStore.getState().internal_ensureReportedInputTokenFloorWatermark();

    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a1',
    });
    expect(
      getLatestReportedInputTokens(afterFresh, {
        afterMessageId: 'a1',
        lookupMessages: afterFresh,
      }),
    ).toBe(700_000);
  });

  it('does not persist an inline summary after a post-cursor candidate is edited', async () => {
    let releaseSummarizer: (() => void) | undefined;
    const summarizerGate = new Promise<void>((resolve) => {
      releaseSummarizer = resolve;
    });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await summarizerGate;
      await onFinish?.('stale candidate summary', {} as any);
    });
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: { historySummaryLastMessageId: 'a1' },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);

    const compactPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
    });
    await useChatStore.getState().modifyMessageContent('a2', 'edited candidate');
    releaseSummarizer?.();

    const result = await compactPromise;
    expect(result).toMatchObject({ reason: 'conversation_changed', status: 'ineligible' });
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({ historySummary: 'stale candidate summary' }),
    );
  });

  it('does not persist an inline summary after a post-cursor candidate is deleted', async () => {
    let releaseSummarizer: (() => void) | undefined;
    const summarizerGate = new Promise<void>((resolve) => {
      releaseSummarizer = resolve;
    });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await summarizerGate;
      await onFinish?.('deleted candidate summary', {} as any);
    });
    setConversation({
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: { historySummaryLastMessageId: 'a1' },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.mocked(messageService.removeMessages).mockResolvedValue(undefined as never);

    const compactPromise = useChatStore.getState().triggerManualMemoryCompaction();
    await vi.waitFor(() => {
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
    });
    await useChatStore.getState().deleteMessage('a2');
    releaseSummarizer?.();

    const result = await compactPromise;
    expect(result).toMatchObject({ reason: 'conversation_changed', status: 'ineligible' });
    expect(topicService.persistMemoryCompaction).not.toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({ historySummary: 'deleted candidate summary' }),
    );
  });

  it('does not rotate the watermark when delete persistence fails', async () => {
    setConversation({
      messagesMap: {
        [messageMapKey(SESSION_ID, TOPIC_ID)]: [
          message('u1', 'user'),
          message('a1', 'assistant'),
          message('u2', 'user'),
          message('a2', 'assistant'),
          message('u3', 'user'),
          { ...message('a3', 'assistant'), metadata: { totalInputTokens: 1_048_570 } },
        ],
      },
      topicMaps: {
        [SESSION_ID]: [
          {
            createdAt: 1,
            historySummary: 'existing summary',
            id: TOPIC_ID,
            metadata: {
              historySummaryLastMessageId: 'a1',
              reportedInputTokenFloorAfterMessageId: 'a3',
            },
            title: 'Topic',
            updatedAt: 1,
          },
        ],
      },
    });
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue(undefined);
    vi.spyOn(useChatStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    vi.mocked(messageService.removeMessages).mockRejectedValueOnce(new Error('db unavailable'));

    await expect(useChatStore.getState().deleteMessage('a3')).rejects.toThrow('db unavailable');

    expect(topicService.mergeReportedInputTokenFloorWatermark).not.toHaveBeenCalled();
    expect(topicSelectors.currentActiveTopic(useChatStore.getState())?.metadata).toMatchObject({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a3',
    });
  });
});
