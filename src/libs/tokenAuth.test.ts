import { describe, expect, it } from 'vitest';

import { resolveTokenAuthUserId, secureCompareStrings } from './tokenAuth';

const createHeaders = (authorization?: string): Headers => {
  const headers = new Headers();
  if (authorization) headers.set('Authorization', authorization);
  return headers;
};

describe('token authentication', () => {
  it('resolves the configured user only for an exact bearer credential', () => {
    expect(
      resolveTokenAuthUserId(createHeaders('Bearer access-token'), {
        expectedToken: 'access-token',
        userId: 'account-a',
      }),
    ).toBe('account-a');
  });

  it.each([
    ['missing', undefined],
    ['wrong scheme', 'Basic access-token'],
    ['missing token', 'Bearer '],
    ['embedded whitespace', 'Bearer access token'],
    ['wrong token', 'Bearer attacker-token'],
  ])('rejects a %s authorization value', (_caseName, authorization) => {
    expect(
      resolveTokenAuthUserId(createHeaders(authorization), {
        expectedToken: 'access-token',
        userId: 'account-a',
      }),
    ).toBeUndefined();
  });

  it('rejects oversized credentials before comparison', () => {
    expect(
      resolveTokenAuthUserId(createHeaders(`Bearer ${'a'.repeat(4097)}`), {
        expectedToken: 'access-token',
        userId: 'account-a',
      }),
    ).toBeUndefined();
  });

  it('compares equal and unequal values without prefix acceptance', () => {
    expect(secureCompareStrings('access-token', 'access-token')).toBe(true);
    expect(secureCompareStrings('access-token-prefix', 'access-token')).toBe(false);
    expect(secureCompareStrings('attacker-token', 'access-token')).toBe(false);
  });
});
