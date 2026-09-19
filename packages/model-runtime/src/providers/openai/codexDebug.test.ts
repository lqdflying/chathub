import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OPENAI_CODEX_DEBUG_NAMESPACE,
  classifyCodexMediaType,
  classifyCodexStreamSettled,
  isOpenAICodexDebugEnabled,
  logOpenAICodexDebugSafe,
} from './codexDebug';

describe('CHATHUB_OPENAI_CODEX_DEBUG', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['', '0', 'false', 'off'])('is disabled for %j', (value) => {
    vi.stubEnv('CHATHUB_OPENAI_CODEX_DEBUG', value);
    expect(isOpenAICodexDebugEnabled()).toBe(false);
  });

  it('is disabled when unset', () => {
    vi.unstubAllEnvs();
    delete process.env.CHATHUB_OPENAI_CODEX_DEBUG;
    expect(isOpenAICodexDebugEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'on', 'safe', 'verbose', '2'])('is enabled for %j', (value) => {
    vi.stubEnv('CHATHUB_OPENAI_CODEX_DEBUG', value);
    expect(isOpenAICodexDebugEnabled()).toBe(true);
  });

  it('does not log when disabled', () => {
    vi.stubEnv('CHATHUB_OPENAI_CODEX_DEBUG', '0');
    logOpenAICodexDebugSafe('chat_request_settled', { httpStatus: 200 });
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('emits allowlisted fields and drops tokens', () => {
    vi.stubEnv('CHATHUB_OPENAI_CODEX_DEBUG', '1');
    logOpenAICodexDebugSafe('chat_request_settled', {
      accessToken: 'sk-secret',
      durationMs: 12,
      httpStatus: 200,
      mediaType: 'text/event-stream',
      outcome: 'ok',
      userCode: 'ABCD-EFGH',
    });

    const [prefix, json] = consoleLogSpy.mock.calls[0];
    expect(prefix).toBe(`[${OPENAI_CODEX_DEBUG_NAMESPACE}:chat_request_settled]`);
    expect(JSON.parse(json as string)).toMatchObject({
      durationMs: 12,
      httpStatus: 200,
      mediaType: 'text/event-stream',
      outcome: 'ok',
    });
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('ABCD-EFGH');
  });

  it('classifies Codex content types without leaking header parameters', () => {
    expect(classifyCodexMediaType('text/event-stream; charset=utf-8')).toBe('text/event-stream');
    expect(classifyCodexMediaType('text/html')).toBe('text/html');
    expect(classifyCodexMediaType('application/json')).toBe('application/json');
    expect(classifyCodexMediaType('application/pdf')).toBe('other');
    expect(classifyCodexMediaType(null)).toBe('empty');
  });

  it('classifies stream settlement from lifecycle state, not event count', () => {
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 1,
        succeeded: true,
        terminalReason: 'response_failed',
      }),
    ).toEqual({ outcome: 'ok' });
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 1,
        succeeded: false,
        terminalReason: 'response_failed',
      }),
    ).toEqual({ outcome: 'failed', reason: 'response_failed' });
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 1,
        succeeded: false,
        terminalReason: 'max_output_tokens',
      }),
    ).toEqual({ outcome: 'incomplete', reason: 'max_output_tokens' });
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 1,
        succeeded: false,
        terminalReason: 'unexpected_end',
      }),
    ).toEqual({ outcome: 'unexpected_end', reason: 'missing_terminal_event' });
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 1,
        succeeded: false,
        terminalReason: 'invalid_json',
      }),
    ).toEqual({ outcome: 'parse_error', reason: 'invalid_json' });
    expect(
      classifyCodexStreamSettled({
        cancelled: false,
        sseEventCount: 0,
        succeeded: false,
        terminalReason: 'unexpected_end',
      }),
    ).toEqual({ outcome: 'empty' });
    expect(
      classifyCodexStreamSettled({
        cancelled: true,
        sseEventCount: 1,
        succeeded: false,
      }),
    ).toEqual({ outcome: 'cancelled' });
  });
});
