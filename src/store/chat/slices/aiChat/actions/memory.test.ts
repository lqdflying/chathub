import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { estimateContextUsageAsync } from '@/helpers/estimateContextUsageAsync';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { chatService } from '@/services/chat';
import { tryEnqueueConversationGeneration } from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
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
vi.mock('@/services/conversationGeneration', () => ({
  tryEnqueueConversationGeneration: vi.fn(),
}));
vi.mock('@/services/message', () => ({
  messageService: { getConversationVersion: vi.fn() },
}));
vi.mock('@/services/topic', () => ({
  topicService: { updateTopic: vi.fn() },
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
      conversationClearGeneration: 0,
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
        totalToken: 800,
      })
      .mockResolvedValueOnce({
        chatsToken: 4,
        contextMessages: messages.slice(2),
        historySummaryToken: 2,
        totalToken: 600,
      });
    vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
      await onFinish?.('updated cumulative summary', {} as any);
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);
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
    expect(chatService.fetchPresetTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          max_tokens: 400,
          model: 'summary-model',
          provider: 'summary-provider',
        }),
      }),
    );
    expect(topicService.updateTopic).toHaveBeenCalledTimes(1);
    expect(topicService.updateTopic).toHaveBeenCalledWith(
      TOPIC_ID,
      expect.objectContaining({
        historySummary: 'updated cumulative summary',
        metadata: expect.objectContaining({ historySummaryLastMessageId: 'a2' }),
      }),
    );
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
    const attach = vi
      .spyOn(useChatStore.getState(), 'attachConversationGeneration')
      .mockImplementation(vi.fn());

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toEqual({ reason: 'durable_enqueued', status: 'ineligible' });
    expect(tryEnqueueConversationGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          compaction: expect.objectContaining({
            candidateMessageIds: ['u1', 'a1', 'u2', 'a2'],
            expectedFingerprint: expect.any(String),
            expectedHistorySummary: '',
            trigger: 'manual',
          }),
        }),
        conversationVersion: 7,
        expectedConversationVersion: 7,
        kind: 'memory_compaction',
      }),
    );
    expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    expect(topicService.updateTopic).not.toHaveBeenCalled();
  });

  it('does not compact below the configured high watermark', async () => {
    vi.mocked(estimateContextUsageAsync).mockReset().mockResolvedValue({
      chatsToken: 6,
      contextMessages: messages,
      historySummaryToken: 0,
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
    expect(topicService.updateTopic).toHaveBeenCalledWith(
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
  });

  it('returns a failed result when the summarizer rejects', async () => {
    vi.mocked(chatService.fetchPresetTaskResult).mockRejectedValue(new Error('network failed'));

    await expect(useChatStore.getState().triggerManualMemoryCompaction()).resolves.toEqual({
      reason: 'compaction_exception',
      status: 'failed',
    });
    expect(topicService.updateTopic).not.toHaveBeenCalled();
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
    const scheduled = useChatStore.getState().triggerScheduledMemoryCompaction();
    await vi.waitFor(() => expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1));
    release();

    const [manualResult, scheduledResult] = await Promise.all([manual, scheduled]);
    expect(manualResult).toEqual(scheduledResult);
    expect(topicService.updateTopic).toHaveBeenCalledTimes(1);
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
    const background = useChatStore.getState().triggerScheduledMemoryCompaction();
    await vi.waitFor(() => expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1));

    // a pre-send caller joins the same job with its own controller and then aborts
    const controller = new AbortController();
    const joined = useChatStore.getState().triggerTokenThresholdMemoryCompaction(controller);
    controller.abort();

    await expect(joined).resolves.toEqual({ reason: 'aborted', status: 'ineligible' });
    // the background job is untouched and still completes with its single topic write
    release();
    await background;
    expect(topicService.updateTopic).toHaveBeenCalledTimes(1);
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
    expect(topicService.updateTopic).toHaveBeenCalledWith(
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
    expect(vi.mocked(topicService.updateTopic).mock.calls.at(-1)?.[1]).toMatchObject({
      metadata: expect.objectContaining({ historySummaryLastMessageId: 'a84' }),
    });
  });

  it('undoes a summary write that raced an invalidation', async () => {
    vi.mocked(topicService.updateTopic).mockReset();
    // the first (real) write lands, but an invalidation bumps the generation mid-flight
    vi.mocked(topicService.updateTopic).mockImplementationOnce(async () => {
      useChatStore.setState((s) => ({
        memoryCompactionInvalidationGeneration: s.memoryCompactionInvalidationGeneration + 1,
      }));
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);

    const result = await useChatStore.getState().triggerManualMemoryCompaction();

    expect(result).toMatchObject({ reason: 'conversation_changed', status: 'ineligible' });
    // the stale summary is compensated with the same cleared state as invalidation
    expect(topicService.updateTopic).toHaveBeenCalledTimes(2);
    expect(vi.mocked(topicService.updateTopic).mock.calls[1][1]).toMatchObject({
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
    vi.mocked(topicService.updateTopic).mockReset();
    vi.mocked(topicService.updateTopic).mockImplementationOnce(async () => {
      controller.abort();
    });
    vi.mocked(topicService.updateTopic).mockResolvedValue(undefined);

    const result = await useChatStore.getState().triggerTokenThresholdMemoryCompaction(controller);

    expect(result).toEqual({ reason: 'aborted', status: 'ineligible' });
    expect(topicService.updateTopic).toHaveBeenCalledTimes(2);
    expect(vi.mocked(topicService.updateTopic).mock.calls[1]).toEqual([
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
        }),
      }),
    );
  });
});
