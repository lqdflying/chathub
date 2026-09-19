import { describe, expect, it } from 'vitest';

import { requireTrustedXaiOAuthEndpoint } from './oauth';

describe('requireTrustedXaiOAuthEndpoint', () => {
  it('accepts https hosts under x.ai', () => {
    expect(requireTrustedXaiOAuthEndpoint('https://auth.x.ai/oauth/token', 'token_endpoint')).toBe(
      'https://auth.x.ai/oauth/token',
    );
  });

  it('rejects non-x.ai hosts and non-https URLs', () => {
    expect(() => requireTrustedXaiOAuthEndpoint('https://evil.example/token', 'token_endpoint')).toThrow(
      /untrusted token_endpoint/,
    );
    expect(() => requireTrustedXaiOAuthEndpoint('http://auth.x.ai/oauth/token', 'token_endpoint')).toThrow(
      /untrusted token_endpoint/,
    );
  });
});
