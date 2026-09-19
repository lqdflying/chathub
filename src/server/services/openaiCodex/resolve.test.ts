// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLiveSession = vi.hoisted(() => vi.fn());

vi.mock('./oauth', () => ({
  OpenAICodexOAuthService: class {
    resolveLiveSession = resolveLiveSession;
  },
}));

import { OpenAICodexTransientRefreshError } from './errors';
import { applyOpenAICodexChatPayload, resolveOpenAICodexChatPayload } from './resolve';

describe('resolveOpenAICodexChatPayload', () => {
  beforeEach(() => {
    resolveLiveSession.mockReset();
  });

  it('leaves non-OpenAI providers unchanged', async () => {
    const payload = { apiKey: 'sk-test', userId: 'user-1' };

    await expect(
      resolveOpenAICodexChatPayload({} as any, 'anthropic', payload),
    ).resolves.toEqual(payload);
    expect(resolveLiveSession).not.toHaveBeenCalled();
  });

  it('overlays a live Codex session for OpenAI chat', async () => {
    resolveLiveSession.mockResolvedValue({
      accessToken: 'codex-access',
      accountId: 'acct_1',
      expiresAt: new Date('2026-09-19T00:00:00Z'),
    });

    await expect(
      resolveOpenAICodexChatPayload({} as any, 'openai', { userId: 'user-1' }),
    ).resolves.toEqual({
      accountId: 'acct_1',
      apiKey: 'codex-access',
      authMode: 'codex-oauth',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      userId: 'user-1',
    });
  });

  it('does not overlay Codex credentials for structured generation', async () => {
    const payload = { apiKey: 'sk-test', userId: 'user-1' };

    await expect(
      resolveOpenAICodexChatPayload({} as any, 'openai', payload, { purpose: 'structured' }),
    ).resolves.toEqual(payload);
    expect(resolveLiveSession).not.toHaveBeenCalled();
  });

  it('does not fall back to Platform credentials on a transient refresh failure', async () => {
    resolveLiveSession.mockRejectedValueOnce(new OpenAICodexTransientRefreshError(undefined, 503));

    await expect(
      resolveOpenAICodexChatPayload({} as any, 'openai', { apiKey: 'sk-test', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(OpenAICodexTransientRefreshError);
  });

  it('does not put refresh tokens on the chat payload', () => {
    const payload = applyOpenAICodexChatPayload(
      { userId: 'user-1' },
      {
        accessToken: 'codex-access',
        accountId: 'acct_1',
        expiresAt: new Date(),
      },
    );

    expect(JSON.stringify(payload)).not.toContain('refresh');
  });
});
