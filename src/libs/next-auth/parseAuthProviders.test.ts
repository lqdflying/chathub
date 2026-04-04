import { describe, expect, it } from 'vitest';

import { parseAuthProviders } from './parseAuthProviders';

describe('parseAuthProviders', () => {
  it('parses providers without whitespace', () => {
    expect(parseAuthProviders('github,credentials')).toEqual(['github', 'credentials']);
  });

  it('trims each provider token', () => {
    expect(parseAuthProviders(' github, credentials ')).toEqual(['github', 'credentials']);
  });

  it('supports mixed comma separators', () => {
    expect(parseAuthProviders('github， credentials,azure-ad')).toEqual([
      'github',
      'credentials',
      'azure-ad',
    ]);
  });

  it('filters empty provider tokens', () => {
    expect(parseAuthProviders('github, ,credentials,,')).toEqual(['github', 'credentials']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseAuthProviders('   ')).toEqual([]);
  });
});