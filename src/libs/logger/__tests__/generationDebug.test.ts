import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GENERATION_DEBUG_CLIENT_EVENTS,
  GENERATION_DEBUG_NAMESPACE,
  hashGenerationDebugValue,
  isGenerationDebugEnabled,
  logGenerationDebugSafe,
} from '../generationDebug';

describe('CHATHUB_GENERATION_DEBUG emitter', () => {
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
      vi.stubEnv('CHATHUB_GENERATION_DEBUG', value);
      expect(isGenerationDebugEnabled()).toBe(false);
    });

    it('is disabled when the variable is unset', () => {
      vi.unstubAllEnvs();
      delete process.env.CHATHUB_GENERATION_DEBUG;
      expect(isGenerationDebugEnabled()).toBe(false);
    });

    it.each(['1', 'true', 'on', 'safe', 'verbose', '2'])('is enabled for %j', (value) => {
      vi.stubEnv('CHATHUB_GENERATION_DEBUG', value);
      expect(isGenerationDebugEnabled()).toBe(true);
    });

    it('does not log when disabled', () => {
      vi.stubEnv('CHATHUB_GENERATION_DEBUG', '0');
      logGenerationDebugSafe('enqueue_persisted', { kind: 'chat' });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('record shape', () => {
    beforeEach(() => {
      vi.stubEnv('CHATHUB_GENERATION_DEBUG', '1');
    });

    it('emits execute_retrying with the typed event name', () => {
      logGenerationDebugSafe('execute_retrying', {
        attempt: 1,
        errorClass: 'TitleTranscriptEmptyError',
        kind: 'topic_title',
      });

      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${GENERATION_DEBUG_NAMESPACE}:execute_retrying]`);
      expect(JSON.parse(serializedRecord as string)).toMatchObject({
        attempt: 1,
        errorClass: 'TitleTranscriptEmptyError',
        kind: 'topic_title',
      });
    });

    it('keeps leave/return outcome labels readable', () => {
      logGenerationDebugSafe('deferred_lane_resumed', {
        outcome: 'resume_tools',
        spanId: 'gd_0123456789abcdef',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.outcome).toBe('resume_tools');
      expect(record.spanId).toBe('gd_0123456789abcdef');
    });

    it('includes the Claude-like leave/return client events in the report allowlist', () => {
      expect(GENERATION_DEBUG_CLIENT_EVENTS).toEqual(
        expect.arrayContaining([
          'builtin_tool_settled',
          'chat_image_item_settled',
          'chat_image_run_settled',
          'chat_image_run_started',
          'deferred_lane_aborted',
          'deferred_lane_left',
          'deferred_lane_resumed',
          'invalidate_preserved',
          'message_persist_skipped',
          'rag_retrieve_settled',
          'tool_loop_continue',
          'tool_loop_continue_skipped',
          'topic_busy_changed',
          'fetch_stream_error',
          'fetch_stream_interrupted',
        ]),
      );
    });

    it('emits the prefixed-JSON line format with server-side defaults', () => {
      logGenerationDebugSafe('enqueue_persisted', { jobAdded: true, kind: 'chat' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${GENERATION_DEBUG_NAMESPACE}:enqueue_persisted]`);
      const record = JSON.parse(serializedRecord as string);
      expect(record).toMatchObject({
        debugLevel: 'safe',
        jobAdded: true,
        kind: 'chat',
        schemaVersion: 1,
        side: 'server',
      });
      expect(record.timestamp).toEqual(expect.any(String));
    });

    it('keeps safe label and identifier fields, and fingerprints free-form strings', () => {
      logGenerationDebugSafe('enqueue_rejected', {
        kind: 'chat',
        operationHash: hashGenerationDebugValue('cg_private_operation'),
        reason: 'lane_active',
        spanId: 'gd_0123456789abcdef',
        trpcCode: 'CONFLICT',
        unexpectedFreeText: 'PRIVATE_MESSAGE_CONTENT',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.kind).toBe('chat');
      expect(record.reason).toBe('lane_active');
      expect(record.trpcCode).toBe('CONFLICT');
      expect(record.spanId).toBe('gd_0123456789abcdef');
      expect(record.operationHash).toMatch(/^[\da-f]{16}$/);
      // Free-form strings are never emitted verbatim.
      expect(record.unexpectedFreeText).not.toBe('PRIVATE_MESSAGE_CONTENT');
      expect(record.unexpectedFreeText).toMatchObject({ type: 'string' });
      expect(consoleLogSpy.mock.calls[0][1]).not.toContain('PRIVATE_MESSAGE_CONTENT');
    });

    it('keeps deferReason, classifiedAs, and errorKind as readable labels', () => {
      logGenerationDebugSafe('send_rpc_settled', {
        classifiedAs: 'abort',
        deferReason: 'unsupported_tool',
        errorKind: 'webkit_load_failed',
        kind: 'continue',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.classifiedAs).toBe('abort');
      expect(record.deferReason).toBe('unsupported_tool');
      expect(record.errorKind).toBe('webkit_load_failed');
      expect(record.kind).toBe('continue');
    });

    it('emits browser_tool_stubbed with a readable toolName', () => {
      logGenerationDebugSafe('browser_tool_stubbed', {
        shouldContinue: false,
        toolName: 'lobe-image-designer',
      });

      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${GENERATION_DEBUG_NAMESPACE}:browser_tool_stubbed]`);
      expect(JSON.parse(serializedRecord as string)).toMatchObject({
        shouldContinue: false,
        toolName: 'lobe-image-designer',
      });
    });

    it('emits chat_image_task_created with hashed ids, a readable outcome, and an optional spanId', () => {
      logGenerationDebugSafe('chat_image_task_created', {
        index: 0,
        messageHash: hashGenerationDebugValue('message-private'),
        outcome: 'inserted',
        spanId: 'gd_0123456789abcdef',
        taskHash: hashGenerationDebugValue('task-private'),
      });

      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${GENERATION_DEBUG_NAMESPACE}:chat_image_task_created]`);
      const record = JSON.parse(serializedRecord as string);
      expect(record).toMatchObject({
        index: 0,
        outcome: 'inserted',
        spanId: 'gd_0123456789abcdef',
      });
      expect(record.messageHash).toMatch(/^[\da-f]{16}$/);
      expect(record.taskHash).toMatch(/^[\da-f]{16}$/);
      expect(serializedRecord).not.toContain('message-private');
      expect(serializedRecord).not.toContain('task-private');
    });

    it('emits sandbox_run_settled with counts and no code or stdout', () => {
      logGenerationDebugSafe('sandbox_run_settled', {
        fileInCount: 2,
        fileOutCount: 1,
        httpStatus: 200,
        outcome: 'ok',
        provider: 'dify',
        stdoutChars: 12,
      });

      const [prefix, serializedRecord] = consoleLogSpy.mock.calls[0];
      expect(prefix).toBe(`[${GENERATION_DEBUG_NAMESPACE}:sandbox_run_settled]`);
      expect(JSON.parse(serializedRecord as string)).toMatchObject({
        fileInCount: 2,
        fileOutCount: 1,
        httpStatus: 200,
        outcome: 'ok',
        provider: 'dify',
        stdoutChars: 12,
      });
      expect(serializedRecord).not.toContain('print');
    });

    it('drops secret-keyed fields entirely', () => {
      logGenerationDebugSafe('enqueue_received', {
        apiKey: 'sk-super-secret',
        kind: 'chat',
      });

      const serializedRecord = consoleLogSpy.mock.calls[0][1] as string;
      expect(JSON.parse(serializedRecord)).not.toHaveProperty('apiKey');
      expect(serializedRecord).not.toContain('sk-super-secret');
    });

    it('truncates oversized records instead of emitting them', () => {
      // Object keys pass through sanitization, so wide keys push the record
      // past the 16 KiB bound (arrays and property counts are capped).
      const wideObject: Record<string, number> = {};
      for (let index = 0; index < 50; index += 1) {
        wideObject[`paddingKey${'x'.repeat(400)}${index}`] = index;
      }
      logGenerationDebugSafe('execute_transcript_loaded', {
        bigObject: wideObject,
        spanId: 'gd_fedcba9876543210',
      });

      const record = JSON.parse(consoleLogSpy.mock.calls[0][1] as string);
      expect(record.recordTruncated).toBe(true);
      expect(record.spanId).toBe('gd_fedcba9876543210');
      expect(record).not.toHaveProperty('bigObject');
    });
  });

  describe('hashGenerationDebugValue', () => {
    it('produces stable 16-hex fingerprints that differ across inputs', () => {
      const first = hashGenerationDebugValue('session-a');
      expect(first).toMatch(/^[\da-f]{16}$/);
      expect(hashGenerationDebugValue('session-a')).toBe(first);
      expect(hashGenerationDebugValue('session-b')).not.toBe(first);
      expect(first).not.toContain('session');
    });
  });
});
