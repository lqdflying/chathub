import { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import * as conversationGeneration from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';
import { chatSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { deferredBrowserGenerationLaneKey } from '@/store/chat/utils/deferredBrowserGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';

vi.mock('@/components/AntdStaticMethods', () => ({
  notification: { warning: vi.fn() },
}));

vi.mock('@/helpers/durableConversationGeneration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/helpers/durableConversationGeneration')>()),
  // Off-session continue requires the durable client path to pass the
  // !isCurrentConversation early return in internal_coreProcessMessage.
  isClientDurableConversationGenerationEnabled: vi.fn(() => true),
}));

const initialChatState = useChatStore.getInitialState();

describe('cross-session deferred tool continuation agent binding', () => {
  beforeEach(() => {
    useChatStore.setState(initialChatState, true);
    useUserStore.setState({ ownershipInvalidationGeneration: 0 } as any, false);
    useAgentStore.setState(
      {
        activeId: 'session-b',
        agentMap: {
          'session-a': {
            chatConfig: {
              enableCompressHistory: true,
              enableHistoryCount: true,
              enableUserMemoryArchive: true,
              searchMode: 'off',
            },
            model: 'kimi-k2.7-code',
            params: {},
            plugins: [],
            provider: 'moonshot',
            systemRole: 'session A role',
          },
          'session-b': {
            chatConfig: {
              enableCompressHistory: true,
              enableHistoryCount: true,
              enableUserMemoryArchive: true,
              searchMode: 'off',
            },
            model: 'mimo-v2.5-pro',
            params: {},
            plugins: [],
            provider: 'mimo',
            systemRole: 'session B role',
          },
        },
        defaultAgentConfig: { model: 'fallback', params: {}, provider: 'openai' },
      } as any,
      false,
    );
    useSessionStore.setState(
      {
        sessions: [
          { id: 'session-a', type: 'agent' },
          { id: 'session-b', type: 'agent' },
        ],
      } as any,
      false,
    );
    vi.spyOn(messageService, 'getConversationVersion').mockResolvedValue(undefined);
    vi.spyOn(messageService, 'createMessage').mockResolvedValue('assistant-created' as any);
    vi.spyOn(chatSelectors, 'getTraceIdByMessageId').mockReturnValue(vi.fn());
    vi.spyOn(conversationGeneration, 'tryEnqueueConversationGeneration').mockResolvedValue({
      deferred: true,
      reason: 'unsupported_tool',
      toolName: 'kagi',
    } as any);
  });

  it('pairs session A messages with session A model/provider after leave to session B', async () => {
    const parentToolId = 'tool-parent-a';
    const userId = 'user-a';
    const assistantPlaceholderId = 'assistant-a';
    const conversationKey = deferredBrowserGenerationLaneKey('session-a', 'topic-a', null);
    const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream').mockResolvedValue();
    const enqueueSpy = vi.mocked(conversationGeneration.tryEnqueueConversationGeneration);

    useChatStore.setState({
      activeId: 'session-b',
      activeTopicId: 'topic-b',
      conversationClearGeneration: 0,
      conversationNavigationGeneration: 1,
      conversationScopedClearGenerations: {
        [conversationKey]: 0,
      },
      deferredBrowserGenerationLanes: {
        [conversationKey]: {
          assistantMessageId: assistantPlaceholderId,
          reason: 'unsupported_tool',
          toolName: 'kagi',
        },
      },
      internal_createMessage: vi.fn().mockResolvedValue(assistantPlaceholderId),
      messagesMap: {
        [messageMapKey('session-a', 'topic-a')]: [
          { content: 'hello from A', id: userId, role: 'user', sessionId: 'session-a' },
          {
            content: 'tool result',
            id: parentToolId,
            parentId: assistantPlaceholderId,
            role: 'tool',
            sessionId: 'session-a',
          },
          {
            content: '…',
            id: assistantPlaceholderId,
            role: 'assistant',
            sessionId: 'session-a',
            tools: [],
          },
        ] as UIChatMessage[],
        [messageMapKey('session-b', 'topic-b')]: [],
      },
      // Summary/archives live only under session A; getTopicById would miss them
      // while activeId is session B.
      topicMaps: {
        'session-a': [
          {
            historySummary: 'Session A compacted summary',
            id: 'topic-a',
            metadata: {
              historySummaryLastMessageId: 'cursor-msg-a',
              memoryArchives: [
                {
                  at: Date.parse('2026-09-01T00:00:00.000Z'),
                  id: 'arch-a',
                  summaryExcerpt: 'Archive A only',
                },
              ],
            },
            title: 'Topic A',
          } as any,
        ],
        'session-b': [
          {
            historySummary: 'WRONG Session B summary',
            id: 'topic-b',
            metadata: {
              historySummaryLastMessageId: 'cursor-msg-b',
              memoryArchives: [
                {
                  at: Date.parse('2026-09-01T00:00:00.000Z'),
                  id: 'arch-b',
                  summaryExcerpt: 'Archive B wrong',
                },
              ],
            },
            title: 'Topic B',
          } as any,
        ],
      },
      refreshMessages: vi.fn(),
    });

    await useChatStore.getState().triggerAIMessage({
      conversationContext: {
        clearGeneration: 0,
        generation: 1,
        sessionId: 'session-a',
        threadId: null,
        topicId: 'topic-a',
      },
      parentId: parentToolId,
    });

    expect(enqueueSpy).toHaveBeenCalled();
    const enqueueConfig = enqueueSpy.mock.calls[0]?.[0]?.config as {
      historySummary?: string;
      historySummaryLastMessageId?: string;
      model?: string;
      provider?: string;
      systemRole?: string;
    };
    expect(enqueueConfig.model).toBe('kimi-k2.7-code');
    expect(enqueueConfig.provider).toBe('moonshot');
    expect(enqueueConfig.systemRole).toBe('session A role');
    expect(enqueueConfig.model).not.toBe('mimo-v2.5-pro');
    expect(enqueueConfig.historySummary).toContain('Session A compacted summary');
    expect(enqueueConfig.historySummary).toContain('Archive A only');
    expect(enqueueConfig.historySummary).not.toContain('WRONG Session B summary');
    expect(enqueueConfig.historySummaryLastMessageId).toBe('cursor-msg-a');

    expect(streamSpy).toHaveBeenCalled();
    const streamArgs = streamSpy.mock.calls[0]?.[0] as {
      historySummary?: string;
      params?: { model?: string; provider?: string };
    };
    expect(streamArgs.params?.model).toBe('kimi-k2.7-code');
    expect(streamArgs.params?.provider).toBe('moonshot');
    expect(streamArgs.historySummary).toContain('Session A compacted summary');
    expect(streamArgs.historySummary).toContain('Archive A only');
    expect(streamArgs.historySummary).not.toContain('WRONG Session B summary');
  });
});
