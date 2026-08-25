// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPACTION_DEBUG_NAMESPACE } from '@/libs/logger/compactionDebug';
import { createCallerFactory } from '@/libs/trpc/lambda';

import { conversationGenerationRouter } from '../conversationGeneration';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/server/services/conversationGeneration/featureFlag', () => ({
  isDurableConversationGenerationEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/server/services/conversationGeneration/service', () => ({
  ConversationGenerationService: class {},
}));

describe('conversationGenerationRouter.reportCompactionDebug', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const caller = () =>
    createCallerFactory(conversationGenerationRouter)({ userId: 'account-a' } as never);

  it('accepts zero events when compaction debug is off', async () => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '0');

    await expect(
      caller().reportCompactionDebug({
        events: [{ event: 'watcher_armed', fields: { totalToken: 900 } }],
      }),
    ).resolves.toEqual({ accepted: 0 });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('strips malicious client fields and keeps canonical metadata', async () => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');

    const result = await caller().reportCompactionDebug({
      events: [
        {
          event: 'watcher_armed',
          fields: {
            debugLevel: 'verbose',
            highWatermark: 0.8,
            maxTokens: 1000,
            path: 'PRIVATE_MESSAGE_TEXT',
            provider: 'PRIVATE_MESSAGE_TEXT',
            ratio: 0.9,
            schemaVersion: 999,
            side: 'server',
            spanId: 'PRIVATE_MESSAGE_TEXT',
            timestamp: 'PRIVATE_MESSAGE_TEXT',
            totalToken: 900,
            trigger: 'PRIVATE_MESSAGE_TEXT',
          },
        },
      ],
    });

    expect(result).toEqual({ accepted: 1 });
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [prefix, serialized] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe(`[${COMPACTION_DEBUG_NAMESPACE}:watcher_armed]`);
    expect(serialized).not.toContain('PRIVATE_MESSAGE_TEXT');
    const record = JSON.parse(serialized as string);
    expect(record).toMatchObject({
      debugLevel: 'safe',
      highWatermark: 0.8,
      maxTokens: 1000,
      ratio: 0.9,
      schemaVersion: 1,
      side: 'client',
      totalToken: 900,
    });
    expect(record).not.toHaveProperty('path');
    expect(record).not.toHaveProperty('provider');
    expect(record).not.toHaveProperty('spanId');
    expect(record).not.toHaveProperty('trigger');
    expect(record.timestamp).toEqual(expect.any(String));
    expect(record.timestamp).not.toBe('PRIVATE_MESSAGE_TEXT');
  });

  it('keeps the real planner_settled shape readable', async () => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');

    await caller().reportCompactionDebug({
      events: [
        {
          event: 'planner_settled',
          fields: {
            chatsToken: 10,
            maxTokens: 1000,
            path: 'pre_send',
            provider: 'openai',
            reason: 'below_high_watermark',
            sessionHash: '0123456789abcdef',
            spanId: 'cd_0123456789abcdef',
            status: 'not_needed',
            totalToken: 100,
            trigger: 'token_threshold',
          },
        },
      ],
    });

    const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
    expect(record).toMatchObject({
      chatsToken: 10,
      debugLevel: 'safe',
      maxTokens: 1000,
      path: 'pre_send',
      provider: 'openai',
      reason: 'below_high_watermark',
      schemaVersion: 1,
      sessionHash: '0123456789abcdef',
      side: 'client',
      spanId: 'cd_0123456789abcdef',
      status: 'not_needed',
      totalToken: 100,
      trigger: 'token_threshold',
    });
  });

  it('keeps the real watcher_armed shape readable', async () => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');

    await caller().reportCompactionDebug({
      events: [
        {
          event: 'watcher_armed',
          fields: {
            highWatermark: 0.8,
            knowledgeBaseToken: 40,
            maxTokens: 1000,
            ratio: 0.9,
            sessionHash: '0123456789abcdef',
            topicHash: 'fedcba9876543210',
            totalToken: 900,
          },
        },
      ],
    });

    expect(JSON.parse(consoleLogSpy.mock.calls[0][1] as string)).toMatchObject({
      highWatermark: 0.8,
      knowledgeBaseToken: 40,
      maxTokens: 1000,
      ratio: 0.9,
      sessionHash: '0123456789abcdef',
      side: 'client',
      topicHash: 'fedcba9876543210',
      totalToken: 900,
    });
  });

  it('rejects worker events from the client report endpoint', async () => {
    vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');

    await expect(
      caller().reportCompactionDebug({
        events: [{ event: 'worker_settled', fields: { trigger: 'manual' } } as never],
      }),
    ).rejects.toThrow();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
