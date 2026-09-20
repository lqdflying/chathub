// @vitest-environment node
import { describe, expect, it } from 'vitest';

import github from './github';

const GITHUB_OAUTH_ISSUER = 'https://github.com/login/oauth';

describe('GitHub SSO provider', () => {
  it('declares GitHub RFC 9207 issuer so Auth.js does not expect authjs.dev', () => {
    const configured = github.provider;
    const optionsIssuer =
      configured.options && 'issuer' in configured.options
        ? configured.options.issuer
        : undefined;
    const issuer = configured.issuer ?? optionsIssuer;

    expect(issuer).toBe(GITHUB_OAUTH_ISSUER);

    if (configured.issuer !== undefined) {
      expect(configured.issuer).toBe(GITHUB_OAUTH_ISSUER);
    }

    if (optionsIssuer !== undefined) {
      expect(optionsIssuer).toBe(GITHUB_OAUTH_ISSUER);
    }
  });
});
