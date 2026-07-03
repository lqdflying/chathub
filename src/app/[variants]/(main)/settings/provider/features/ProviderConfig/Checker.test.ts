import { describe, expect, it } from 'vitest';

import { hasConnectionCheckOutput } from './Checker';

describe('ProviderConfig Checker', () => {
  it('accepts non-empty text returned by compatible gateways', () => {
    expect(hasConnectionCheckOutput('Hello. What would you like me to work on?\n')).toBe(true);
  });

  it('rejects empty text responses', () => {
    expect(hasConnectionCheckOutput('')).toBe(false);
    expect(hasConnectionCheckOutput('   \n')).toBe(false);
  });
});
