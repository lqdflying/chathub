// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { decodeJwtPayload, resolveOpenAICodexJwtIdentity } from './jwt';

const makeJwt = (payload: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
};

describe('openaiCodex jwt', () => {
  it('decodes a JWT payload without verifying the signature', () => {
    const token = makeJwt({ sub: 'user' });
    expect(decodeJwtPayload(token)).toEqual({ sub: 'user' });
  });

  it('returns undefined for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeUndefined();
  });

  it('reads chatgpt_account_id, plan, and email from OpenAI claims', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
        chatgpt_plan_type: 'plus',
      },
      'https://api.openai.com/profile': { email: 'plus@example.com' },
    });

    expect(resolveOpenAICodexJwtIdentity(token)).toEqual({
      accountId: 'acct_123',
      chatgptPlanType: 'plus',
      email: 'plus@example.com',
    });
  });

  it('requires chatgpt_account_id', () => {
    const token = makeJwt({
      'https://api.openai.com/profile': { email: 'plus@example.com' },
    });

    expect(resolveOpenAICodexJwtIdentity(token)).toBeUndefined();
  });
});
