// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLiveSession = vi.hoisted(() => vi.fn());

vi.mock('./oauth', () => ({
  XaiOAuthService: class {
    resolveLiveSession = resolveLiveSession;
  },
}));

import { XaiOAuthTransientRefreshError } from './errors';
import { applyXaiOAuthChatPayload, resolveXaiOAuthChatPayload } from './resolve';

describe('resolveXaiOAuthChatPayload', () => {
  beforeEach(() => {
    resolveLiveSession.mockReset();
  });

  it('leaves non-xAI providers unchanged', async () => {
    const payload = { apiKey: 'sk-test', userId: 'user-1' };

    await expect(resolveXaiOAuthChatPayload({} as any, 'openai', payload)).resolves.toEqual(payload);
    expect(resolveLiveSession).not.toHaveBeenCalled();
  });

  it('overlays a live SuperGrok session onto the chat proxy', async () => {
    resolveLiveSession.mockResolvedValue({
      accessToken: 'xai-access',
      expiresAt: new Date('2026-09-19T00:00:00Z'),
    });

    await expect(resolveXaiOAuthChatPayload({} as any, 'xai', { userId: 'user-1' })).resolves.toEqual({
      apiKey: 'xai-access',
      authMode: 'xai-oauth',
      baseURL: 'https://cli-chat-proxy.grok.com/v1',
      userId: 'user-1',
    });
  });

  it('does not overlay SuperGrok credentials for structured generation', async () => {
    const payload = { apiKey: 'sk-test', userId: 'user-1' };

    await expect(
      resolveXaiOAuthChatPayload({} as any, 'xai', payload, { purpose: 'structured' }),
    ).resolves.toEqual(payload);
    expect(resolveLiveSession).not.toHaveBeenCalled();
  });

  it('does not fall back to Console credentials on a transient refresh failure', async () => {
    resolveLiveSession.mockRejectedValueOnce(new XaiOAuthTransientRefreshError('unavailable', 503));

    await expect(
      resolveXaiOAuthChatPayload({} as any, 'xai', { apiKey: 'sk-test', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(XaiOAuthTransientRefreshError);
  });

  it('does not put refresh tokens on the chat payload', () => {
    const payload = applyXaiOAuthChatPayload(
      { userId: 'user-1' },
      {
        accessToken: 'xai-access',
        expiresAt: new Date(),
      },
    );

    expect(JSON.stringify(payload)).not.toContain('refresh');
  });
});
