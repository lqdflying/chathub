import { ASSISTANT_MEMORY_NO_CHANGES_SENTINEL } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTopics = vi.fn();
const countTopics = vi.fn();
const chat = vi.fn();
const consume = vi.fn();
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    countTopicsForAssistantMemoryDream = countTopics;
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

vi.mock('@/server/services/conversationGeneration/stream', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/conversationGeneration/stream')>();
  return {
    ...actual,
    consumeProtocolResponse: (...args: unknown[]) => consume(...args),
  };
});

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
const SNAPSHOT_UPDATED_AT = new Date('2026-08-27T10:00:00.000Z');

const agentRow = {
  assistantMemory: 'prior memory',
  assistantMemoryMeta: {},
  chatConfig: { memoryDreamScheduleFrequency: 'daily', memoryDreamScheduleTime: '02:00' },
  fixedMemory: '',
  updatedAt: SNAPSHOT_UPDATED_AT,
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
    updateReturning.mockResolvedValue([{ id: 'agent-1' }]);
    countTopics.mockResolvedValue(1);
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
        assistantMemory: expect.stringMatching(/#2 \[2026-08-27\]:[\s\S]*Prefers tables/),
        assistantMemoryMeta: expect.objectContaining({
          lastDreamAt: expect.any(String),
          lastDreamMarker: PERIOD,
          lastDreamStatus: 'completed',
          lastError: null,
        }),
      }),
    );
    expect(updateWhere).toHaveBeenCalled();
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
        assistantMemoryMeta: expect.objectContaining({
          lastDreamAt: expect.any(String),
          lastDreamMarker: PERIOD,
          lastDreamStatus: 'completed',
          lastError: null,
        }),
      }),
    );
    expect(updateSet.mock.calls[0][0].assistantMemory).toBeUndefined();
  });

  it('writes the marker when yesterday had no active topics', async () => {
    countTopics.mockResolvedValue(0);
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
          lastDreamAt: expect.any(String),
          lastDreamStatus: 'failed',
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

  it('skips append when a card for that history date already exists', async () => {
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-27]:\nexisting',
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ reason: 'already_has_card', status: 'skipped' });
    expect(chat).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMemoryMeta: expect.objectContaining({
          lastDreamMarker: PERIOD,
          lastDreamStatus: 'completed',
        }),
      }),
    );
    expect(updateSet.mock.calls[0][0].assistantMemory).toBeUndefined();
  });

  it('re-summarizes overflow when a new day pushes past keep-N', async () => {
    consume
      .mockResolvedValueOnce({ content: '- Prefers tables\n', error: undefined, stopReason: 'stop' })
      .mockResolvedValueOnce({
        content: 'Older standing preference: bullets',
        error: undefined,
        stopReason: 'stop',
      });
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-26]:\nold day body',
      chatConfig: {
        memoryDreamMaxEntries: 1,
        memoryDreamScheduleFrequency: 'daily',
        memoryDreamScheduleTime: '02:00',
      },
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(chat).toHaveBeenCalledTimes(2);
    const stored = updateSet.mock.calls[0][0].assistantMemory as string;
    expect(stored).toContain('[2026-08-27]');
    expect(stored).toContain('Prefers tables');
    expect(stored).toContain('2026-08-26..2026-08-26');
    expect(stored).toContain('Older standing preference: bullets');
    expect(stored).not.toContain('old day body');
  });

  it('asks the model to rewrite an over-budget overflow summary instead of trimming it', async () => {
    consume
      .mockResolvedValueOnce({ content: '- Prefers tables\n', error: undefined })
      .mockResolvedValueOnce({ content: `KEEP-THIS-TAIL ${'x'.repeat(8000)}`, error: undefined })
      .mockResolvedValueOnce({ content: 'Compressed standing preference: bullets', error: undefined });
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-26]:\nold day body',
      chatConfig: {
        memoryDreamMaxEntries: 1,
        memoryDreamScheduleFrequency: 'daily',
        memoryDreamScheduleTime: '02:00',
      },
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(chat).toHaveBeenCalledTimes(3);
    const stored = updateSet.mock.calls[0][0].assistantMemory as string;
    expect(stored).toContain('Compressed standing preference: bullets');
    expect(stored).not.toContain('KEEP-THIS-TAIL');
    expect(stored).not.toContain('x'.repeat(8000));
  });

  it('asks the model to rewrite a token-truncated overflow summary', async () => {
    consume
      .mockResolvedValueOnce({ content: '- Prefers tables\n', error: undefined, stopReason: 'stop' })
      .mockResolvedValueOnce({
        content: 'partial CUT-MID-SENTENCE',
        error: undefined,
        stopReason: 'length',
      })
      .mockResolvedValueOnce({
        content: 'Compressed standing preference: bullets',
        error: undefined,
        stopReason: 'stop',
      });
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-26]:\nold day body',
      chatConfig: {
        memoryDreamMaxEntries: 1,
        memoryDreamScheduleFrequency: 'daily',
        memoryDreamScheduleTime: '02:00',
      },
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(chat).toHaveBeenCalledTimes(3);
    const stored = updateSet.mock.calls[0][0].assistantMemory as string;
    expect(stored).toContain('Compressed standing preference: bullets');
    expect(stored).not.toContain('CUT-MID-SENTENCE');
  });

  it('falls back to concat when the overflow rewrite is also token-truncated', async () => {
    consume
      .mockResolvedValueOnce({ content: '- Prefers tables\n', error: undefined, stopReason: 'stop' })
      .mockResolvedValueOnce({
        content: 'partial CUT-MID-SENTENCE',
        error: undefined,
        stopReason: 'max_tokens',
      })
      .mockResolvedValueOnce({
        content: 'still truncated CUT-MID-SENTENCE',
        error: undefined,
        stopReason: 'MAX_TOKENS',
      });
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-26]:\nold day body',
      chatConfig: {
        memoryDreamMaxEntries: 1,
        memoryDreamScheduleFrequency: 'daily',
        memoryDreamScheduleTime: '02:00',
      },
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(chat).toHaveBeenCalledTimes(3);
    const stored = updateSet.mock.calls[0][0].assistantMemory as string;
    expect(stored).toContain('[2026-08-27]');
    expect(stored).toContain('Prefers tables');
    expect(stored).toContain('old day body');
    expect(stored).not.toContain('CUT-MID-SENTENCE');
  });

  it('falls back to concat when overflow re-summarize fails', async () => {
    consume
      .mockResolvedValueOnce({ content: '- Prefers tables\n', error: undefined })
      .mockResolvedValueOnce({ content: '', error: { message: 'fold failed', type: 'error' } });
    const db = createDb({
      ...agentRow,
      assistantMemory: '#1 [2026-08-26]:\nold day body',
      chatConfig: {
        memoryDreamMaxEntries: 1,
        memoryDreamScheduleFrequency: 'daily',
        memoryDreamScheduleTime: '02:00',
      },
    });
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'success' });
    const stored = updateSet.mock.calls[0][0].assistantMemory as string;
    expect(stored).toContain('[2026-08-27]');
    expect(stored).toContain('Prefers tables');
    expect(stored).toContain('old day body');
  });

  it('does not overwrite memory when the agent row changed during the model call', async () => {
    updateReturning.mockResolvedValueOnce([]);
    const db = createDb();
    const result = await executeAssistantMemoryDream({
      agentId: 'agent-1',
      db,
      now: NOW,
      periodStamp: PERIOD,
      userId: 'user-1',
    });

    expect(result).toMatchObject({ reason: 'stale_conflict', status: 'skipped' });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateReturning).toHaveBeenCalled();
  });
});
