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

  it('Safari abort path accepts reasoning-only content the same as onFinish', () => {
    // Mirrors Checker onAbort: hasConnectionCheckResult(text, { content: reasoningContent })
    expect(hasConnectionCheckResult('', { content: 'thinking trace' })).toBe(true);
    expect(hasConnectionCheckResult('', { content: '' })).toBe(false);
    expect(hasConnectionCheckResult('hello', { content: '' })).toBe(true);
  });

  it('uses the selected checker model when present', () => {
    expect(resolveConnectionCheckModel('gpt-5.5', 'gpt-5-nano')).toBe('gpt-5.5');
    expect(resolveConnectionCheckModel('  ', 'gpt-5-nano')).toBe('gpt-5-nano');
  });
});
