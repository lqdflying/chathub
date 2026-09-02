import { describe, expect, it } from 'vitest';

import { hasConnectionCheckOutput, hasConnectionCheckResult } from './connectionCheckParams';
import { resolveConnectionCheckModel } from './Checker';

describe('ProviderConfig Checker', () => {
  it('accepts non-empty text returned by compatible gateways', () => {
    expect(hasConnectionCheckOutput('Hello. What would you like me to work on?\n')).toBe(true);
  });

  it('rejects empty text responses', () => {
    expect(hasConnectionCheckOutput('')).toBe(false);
    expect(hasConnectionCheckOutput('   \n')).toBe(false);
  });

  it('accepts reasoning-only connectivity output', () => {
    expect(hasConnectionCheckResult('', { content: 'trace' })).toBe(true);
  });

  it('Safari abort path accepts reasoning from interrupt.reasoning or message buffer', () => {
    // Ordering (reasoning event then WebKit Load failed before 300ms) is in
    // packages/fetch-sse fetchSSE tests. This asserts Checker's consume rule.
    const reasoningAtAbort = (interruptReasoning?: string, buffered?: string) =>
      interruptReasoning || buffered || '';

    expect(
      hasConnectionCheckResult('', { content: reasoningAtAbort('thinking trace', '') }),
    ).toBe(true);
    expect(hasConnectionCheckResult('', { content: reasoningAtAbort(undefined, 'buffered') })).toBe(
      true,
    );
    expect(hasConnectionCheckResult('', { content: reasoningAtAbort(undefined, '') })).toBe(false);
    expect(hasConnectionCheckResult('hello', { content: reasoningAtAbort(undefined, '') })).toBe(
      true,
    );
  });

  it('empty WebKit abort must not count as a settled failure by itself', () => {
    // Checker only settlePass on abort when content exists; empty abort waits for
    // onFinish recovery (response.clone after Load failed).
    expect(hasConnectionCheckResult('', { content: '' })).toBe(false);
  });

  it('uses the selected checker model when present', () => {
    expect(resolveConnectionCheckModel('gpt-5.5', 'gpt-5-nano')).toBe('gpt-5.5');
    expect(resolveConnectionCheckModel('  ', 'gpt-5-nano')).toBe('gpt-5-nano');
  });
});
