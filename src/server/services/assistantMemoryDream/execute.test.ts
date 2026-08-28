import { ASSISTANT_MEMORY_NO_CHANGES_SENTINEL } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTopics = vi.fn();
const chat = vi.fn();
const consume = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    listTopicsForAssistantMemoryDream = listTopics;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserState = vi.fn(async () => ({
      settings: { systemAgent: { historyCompress: { model: 'gpt-4o-mini', provider: 'openai' } } },
    }));
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(() => ({ chat })),
}));

vi.mock('@/server/services/conversationGeneration/credentials', () => ({
  resolveConversationRuntimePayload: vi.fn(async () => ({
    apiKey: 'sk-test',
    runtimeProvider: 'openai',
  })),
}));

vi.mock('@/server/services/conversationGeneration/runtimeChatOptions', () => ({
  createConversationRuntimeChatOptions: vi.fn(() => ({})),
}));

vi.mock('@/server/services/conversationGeneration/stream', () => ({
  consumeProtocolResponse: (...args: unknown[]) => consume(...args),
}));

vi.mock('@/libs/logger/compactionDebug', () => ({
  logCompactionDebugSafe: vi.fn(),
}));

vi.mock('@/helpers/assistantMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/helpers/assistantMemory')>();
  return {
    ...actual,
    capAssistantMemoryByTokensAsync: vi.fn(async (text: string) => text),
  };
});

import { executeAssistantMemoryDream } from './execute';

const NOW = new Date('2026-08-28T03:00:00.000Z');
const PERIOD = '2026-08-28';

const agentRow = {
  assistantMemory: 'prior memory',
  assistantMemoryMeta: {},
  chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
  fixedMemory: '',
};

const createDb = (row: typeof agentRow | undefined = agentRow) =>
  ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (row ? [row] : [])),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: updateSet })),
  }) as any;

describe('executeAssistantMemoryDream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhere.mockResolvedValue(undefined);
    listTopics.mockResolvedValue([
      {
        historySummary: 'user prefers tables',
        id: 't1',
        lastActivityAt: new Date('2026-08-27T12:00:00.000Z'),
        sessionId: 's1',
        title: 'Topic',
        updatedAt: new Date(),
      },
    ]);
    chat.mockResolvedValue({});
    consume.mockResolvedValue({ content: '- Prefers tables\n', error: undefined });
  });

  it('writes updated memory and the period marker on success', async () => {
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success', topicsWithSummary: 1 });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMemory: expect.stringContaining('Prefers tables'),
        assistantMemoryMeta: expect.objectContaining({
          lastDreamMarker: PERIOD,
          lastError: null,
        }),
      }),
    );
  });

  it('writes the marker without changing memory on NO_CHANGES', async () => {
    consume.mockResolvedValue({ content: ASSISTANT_MEMORY_NO_CHANGES_SENTINEL, error: undefined });
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ reason: 'no_changes', status: 'skipped' });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMemoryMeta: expect.objectContaining({ lastDreamMarker: PERIOD, lastError: null }),
      }),
    );
    expect(updateSet.mock.calls[0][0].assistantMemory).toBeUndefined();
  });

  it('writes the marker when yesterday had no active topics', async () => {
    listTopics.mockResolvedValue([]);
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      activeTopicCount: 0,
      reason: 'no_active_topics_yesterday',
      status: 'skipped',
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMemoryMeta: expect.objectContaining({ lastDreamMarker: PERIOD }),
      }),
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it('records lastError without a marker when completion fails', async () => {
    consume.mockResolvedValue({ content: '', error: { message: 'upstream', type: 'ProviderError' } });
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ reason: 'completion_failed', status: 'failed' });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMemoryMeta: expect.objectContaining({
          lastError: expect.objectContaining({ message: 'upstream' }),
        }),
      }),
    );
    expect(updateSet.mock.calls[0][0].assistantMemoryMeta.lastDreamMarker).toBeUndefined();
  });

  it('skips a stale job whose period stamp no longer matches', async () => {
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: '2026-08-27',
      userId: 'user-1',
    });

    expect(result).toMatchObject({ reason: 'stale_job', status: 'skipped' });
    expect(listTopics).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });
});
