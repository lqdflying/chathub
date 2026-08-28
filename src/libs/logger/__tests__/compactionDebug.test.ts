import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPACTION_DEBUG_CLIENT_EVENTS,
  COMPACTION_DEBUG_NAMESPACE,
  hashCompactionDebugValue,
  isCompactionDebugEnabled,
  logCompactionDebugSafe,
} from '../compactionDebug';

describe('CHATHUB_COMPACTION_DEBUG emitter', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('gating', () => {
    it.each(['', '0', 'false', 'off'])('is disabled for %j', (value) => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', value);
      expect(isCompactionDebugEnabled()).toBe(false);
    });

    it('is disabled when the variable is unset', () => {
      vi.unstubAllEnvs();
      delete process.env.CHATHUB_COMPACTION_DEBUG;
      expect(isCompactionDebugEnabled()).toBe(false);
    });

    it.each(['1', 'true', 'on', 'safe', 'verbose', '2'])('is enabled for %j', (value) => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', value);
      expect(isCompactionDebugEnabled()).toBe(true);
    });

    it('does not log when disabled', () => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '0');
      logCompactionDebugSafe('planner_settled', { trigger: 'token_threshold' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('record shape', () => {
    beforeEach(() => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');
    });

    it('includes the client events in the report allowlist', () => {
      expect(COMPACTION_DEBUG_CLIENT_EVENTS).toEqual(['planner_settled', 'watcher_armed']);
    });

    it('emits the prefixed-JSON line format with server-side defaults', () => {
      logCompactionDebugSafe('planner_settled', {
        path: 'pre_send',
        reason: 'below_high_watermark',
        status: 'not_needed',
        trigger: 'token_threshold',
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${COMPACTION_DEBUG_NAMESPACE}:planner_settled]`);
      const record = JSON.parse(serializedRecord as string);
      expect(record).toMatchObject({
        debugLevel: 'safe',
        path: 'pre_send',
        reason: 'below_high_watermark',
        schemaVersion: 1,
        side: 'server',
        status: 'not_needed',
        trigger: 'token_threshold',
      });
      expect(record.timestamp).toEqual(expect.any(String));
    });

    it('keeps numeric token-usage fields and ratios', () => {
      logCompactionDebugSafe('planner_settled', {
        chatsToken: 10,
        historySummaryToken: 20,
        inputToken: 5,
        maxTokens: 258_000,
        memoryToken: 30,
        ratio: 0.2,
        systemRoleToken: 40,
        toolsToken: 50,
        totalToken: 155,
        trigger: 'message_count',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record).toMatchObject({
        chatsToken: 10,
        historySummaryToken: 20,
        inputToken: 5,
        maxTokens: 258_000,
        memoryToken: 30,
        ratio: 0.2,
        systemRoleToken: 40,
        toolsToken: 50,
        totalToken: 155,
        trigger: 'message_count',
      });
    });

    it('omits verbose-only flag booleans at the safe level', () => {
      logCompactionDebugSafe('planner_settled', {
        enableCompressHistory: true,
        historyCount: 20,
        trigger: 'token_threshold',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.historyCount).toBe(20);
      expect(record).not.toHaveProperty('enableCompressHistory');
    });

    it('keeps built-in model ids readable while fingerprinting custom model ids', () => {
      logCompactionDebugSafe('worker_settled', {
        model: 'gpt-5-mini',
        provider: 'openai',
        sessionId: 'sess-private-conversation',
        trigger: 'manual',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.model).toBe('gpt-5-mini');
      expect(record.provider).toBe('openai');
      expect(record).not.toHaveProperty('sessionId');
      expect(consoleLogSpy.mock.calls[0][1]).not.toContain('sess-private-conversation');
    });

    it('fingerprints unknown provider slugs while keeping trusted ModelProvider ids readable', () => {
      logCompactionDebugSafe('planner_settled', {
        provider: 'private-customer-acme',
        trigger: 'token_threshold',
      });

      const serialized = consoleLogSpy.mock.calls[0][1] as string;
      const record = JSON.parse(serialized);
      expect(record.provider).toMatchObject({ type: 'string' });
      expect(serialized).not.toContain('private-customer-acme');

      consoleLogSpy.mockClear();
      logCompactionDebugSafe('planner_settled', {
        provider: 'openai',
        trigger: 'token_threshold',
      });
      expect(JSON.parse(consoleLogSpy.mock.calls[0][1] as string).provider).toBe('openai');
    });

    it('fingerprints arbitrary custom model identifiers in safe compaction logs', () => {
      logCompactionDebugSafe('planner_settled', {
        model: 'customer-acme-private-deployment',
        provider: 'openaicompatible',
        trigger: 'token_threshold',
      });

      const serialized = consoleLogSpy.mock.calls[0][1] as string;
      const record = JSON.parse(serialized);
      expect(record.provider).toBe('openaicompatible');
      expect(record.model).toMatchObject({ type: 'string' });
      expect(serialized).not.toContain('customer-acme-private-deployment');
    });

    it('never emits summary text or message content', () => {
      logCompactionDebugSafe('planner_settled', {
        historySummary: 'PRIVATE_SUMMARY_TEXT',
        unexpectedFreeText: 'PRIVATE_MESSAGE_CONTENT',
        trigger: 'manual',
      });

      const serialized = consoleLogSpy.mock.calls[0][1] as string;
      const record = JSON.parse(serialized);
      expect(record).not.toHaveProperty('historySummary');
      expect(record).not.toHaveProperty('unexpectedFreeText');
      expect(serialized).not.toContain('PRIVATE_SUMMARY_TEXT');
      expect(serialized).not.toContain('PRIVATE_MESSAGE_CONTENT');
    });

    it('drops secret-keyed fields entirely', () => {
      logCompactionDebugSafe('worker_settled', {
        apiKey: 'sk-super-secret',
        trigger: 'scheduled',
      });

      const serializedRecord = consoleLogSpy.mock.calls[0][1] as string;
      expect(JSON.parse(serializedRecord)).not.toHaveProperty('apiKey');
      expect(serializedRecord).not.toContain('sk-super-secret');
    });

    it('strips untrusted labels and keeps canonical metadata after caller fields', () => {
      logCompactionDebugSafe(
        'watcher_armed',
        {
          debugLevel: 'verbose',
          highWatermark: 0.8,
          maxTokens: 1000,
          path: 'PRIVATE_MESSAGE_TEXT',
          provider: 'PRIVATE_MESSAGE_TEXT',
          ratio: 0.9,
          schemaVersion: 999,
          side: 'client',
          spanId: 'PRIVATE_MESSAGE_TEXT',
          timestamp: 'PRIVATE_MESSAGE_TEXT',
          totalToken: 900,
          trigger: 'PRIVATE_MESSAGE_TEXT',
        },
        { side: 'client' },
      );

      const serialized = consoleLogSpy.mock.calls[0][1] as string;
      const record = JSON.parse(serialized);
      expect(serialized).not.toContain('PRIVATE_MESSAGE_TEXT');
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

    it('ignores caller-supplied side and reserved metadata without a trusted option', () => {
      logCompactionDebugSafe('planner_settled', {
        debugLevel: 'verbose',
        path: 'pre_send',
        schemaVersion: 999,
        side: 'client',
        trigger: 'token_threshold',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record).toMatchObject({
        debugLevel: 'safe',
        path: 'pre_send',
        schemaVersion: 1,
        side: 'server',
        trigger: 'token_threshold',
      });
    });
  });

  describe('dream scheduler events', () => {
    beforeEach(() => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', '1');
    });

    it('emits dream_scheduler_tick fields verbatim', () => {
      logCompactionDebugSafe('dream_scheduler_tick', {
        due: true,
        frequency: 'daily',
        path: 'assistant_memory_rollup',
        scheduleTime: '02:00',
        trigger: 'scheduled',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record).toMatchObject({
        due: true,
        frequency: 'daily',
        path: 'assistant_memory_rollup',
        scheduleTime: '02:00',
        side: 'server',
        trigger: 'scheduled',
      });
    });

    it('emits dream_scheduler_settled window dates verbatim', () => {
      logCompactionDebugSafe('dream_scheduler_settled', {
        activeTopicCount: 3,
        activityWindowEnd: '2026-08-28',
        activityWindowStart: '2026-08-27',
        path: 'assistant_memory_rollup',
        reason: 'no_changes',
        status: 'skipped',
        topicsWithSummary: 2,
        trigger: 'scheduled',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record).toMatchObject({
        activeTopicCount: 3,
        activityWindowEnd: '2026-08-28',
        activityWindowStart: '2026-08-27',
        path: 'assistant_memory_rollup',
        reason: 'no_changes',
        status: 'skipped',
        topicsWithSummary: 2,
      });
    });
  });

  describe('verbose level', () => {
    it('keeps flag booleans at verbose', () => {
      vi.stubEnv('CHATHUB_COMPACTION_DEBUG', 'verbose');
      logCompactionDebugSafe('planner_settled', {
        enableCompressHistory: true,
        enableHistoryCount: true,
        trigger: 'token_threshold',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.debugLevel).toBe('verbose');
      expect(record.enableCompressHistory).toBe(true);
      expect(record.enableHistoryCount).toBe(true);
    });
  });

  describe('hashCompactionDebugValue', () => {
    it('produces stable 16-hex fingerprints that differ across inputs', () => {
      const first = hashCompactionDebugValue('session-a');
      expect(first).toMatch(/^[\da-f]{16}$/);
      expect(hashCompactionDebugValue('session-a')).toBe(first);
      expect(hashCompactionDebugValue('session-b')).not.toBe(first);
      expect(first).not.toContain('session');
    });
  });
});
