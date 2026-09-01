import { describe, expect, it } from 'vitest';

import { ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { laneScopedClearKey } from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { merge } from '@/utils/merge';

import { aiChatSelectors } from './selectors';

const initialStore = initialState as ChatStore;
const sessionId = 'session-1';
const topicId = 'topic-1';
const mapKey = messageMapKey(sessionId, topicId);
const laneKey = laneScopedClearKey(sessionId, topicId, null);

describe('aiChatSelectors.isActiveTopicMemoryCompacting', () => {
  it('is false with no active topic or compaction work', () => {
    expect(aiChatSelectors.isActiveTopicMemoryCompacting(initialStore)).toBe(false);
  });

  it('is true when a memory_compaction operation is attached for the active topic', () => {
    const state = merge(initialStore, {
      activeId: sessionId,
      activeTopicId: topicId,
      serverGenerationOperations: {
        [mapKey]: {
          cgo_compact: {
            clearGeneration: 0,
            generation: 0,
            kind: 'memory_compaction',
            lane: 'lane-compact',
            operationId: 'cgo_compact',
            sessionId,
            topicId,
            userScope: 'current',
          },
        },
      },
    });

    expect(aiChatSelectors.isActiveTopicMemoryCompacting(state)).toBe(true);
  });

  it('is false when only a chat operation is attached', () => {
    const state = merge(initialStore, {
      activeId: sessionId,
      activeTopicId: topicId,
      serverGenerationOperations: {
        [mapKey]: {
          cgo_chat: {
            clearGeneration: 0,
            generation: 0,
            kind: 'chat',
            lane: 'lane-chat',
            operationId: 'cgo_chat',
            sessionId,
            topicId,
            userScope: 'current',
          },
        },
      },
    });

    expect(aiChatSelectors.isActiveTopicMemoryCompacting(state)).toBe(false);
  });

  it('is true while a memory_compaction enqueue is in flight', () => {
    const state = merge(initialStore, {
      activeId: sessionId,
      activeTopicId: topicId,
      durableInFlightEnqueues: {
        [laneKey]: [{ idempotencyKey: 'compaction:fp', kind: 'memory_compaction' }],
      },
    });

    expect(aiChatSelectors.isActiveTopicMemoryCompacting(state)).toBe(true);
  });

  it('is false after attached and in-flight compaction entries are cleared', () => {
    const state = merge(initialStore, {
      activeId: sessionId,
      activeTopicId: topicId,
      durableInFlightEnqueues: {},
      serverGenerationOperations: {
        [mapKey]: {},
      },
    });

    expect(aiChatSelectors.isActiveTopicMemoryCompacting(state)).toBe(false);
  });
});
