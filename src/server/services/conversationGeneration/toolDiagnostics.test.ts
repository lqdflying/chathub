/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryManifest } from '@/tools/memory';
import { WebBrowsingManifest } from '@/tools/web-browsing';

import {
  createConversationToolBatchCorrelation,
  reportConversationToolBatch,
  reportConversationToolCompletion,
  resolveConversationToolRuntimeType,
  toConversationToolCacheMetadata,
} from './toolDiagnostics';

describe('conversation tool diagnostics', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('classifies builtin and HTTP MCP identifiers without exposing names in the type map', () => {
    expect(resolveConversationToolRuntimeType(WebBrowsingManifest.identifier)).toBe('builtin');
    expect(resolveConversationToolRuntimeType(MemoryManifest.identifier)).toBe('builtin');
    expect(resolveConversationToolRuntimeType('notion', true)).toBe('mcp');
    expect(resolveConversationToolRuntimeType('unknown-plugin')).toBe('server');
  });

  it('emits hashed batch and completion records when CHATHUB_TOOLS_DEBUG is on', () => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '1');
    const correlation = createConversationToolBatchCorrelation(
      ['call-private-1', 'call-private-2'],
      1,
      'private-session',
    );

    reportConversationToolBatch(correlation, 'started');
    reportConversationToolCompletion({
      correlation,
      identifier: WebBrowsingManifest.identifier,
      outcome: 'completed',
      toolCallId: 'call-private-1',
    });
    reportConversationToolBatch(
      { ...correlation, failureCount: 0, resultCount: 1 },
      'settled',
    );

    const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('[chathub-tools-debug:tool_batch_started]');
    expect(output).toContain('[chathub-tools-debug:tool_completion_reported]');
    expect(output).toContain('[chathub-tools-debug:tool_batch_settled]');
    expect(output).not.toContain('call-private-1');
    expect(output).not.toContain('private-session');
    expect(toConversationToolCacheMetadata({ ...correlation, failureCount: 0, resultCount: 1 }))
      .toMatchObject({
        batchId: correlation.batchId,
        continuationId: correlation.continuationId,
        resultCount: 1,
        toolCallCount: 2,
      });
  });

  it('does not emit records when the tools debug switch is off', () => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '0');
    const correlation = createConversationToolBatchCorrelation(['call-1'], 1);

    reportConversationToolBatch(correlation, 'started');
    reportConversationToolCompletion({
      correlation,
      identifier: 'notion',
      isHttpMcp: true,
      outcome: 'failed',
      toolCallId: 'call-1',
    });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
