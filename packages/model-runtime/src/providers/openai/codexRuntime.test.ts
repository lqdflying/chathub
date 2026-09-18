// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OPENAI_CODEX_AUTH_MODE } from './codexConstants';
import { LobeOpenAI } from './index';

describe('LobeOpenAI Codex branch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts chat to the Codex responses endpoint when authMode is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n', {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runtime = new LobeOpenAI({
      accountId: 'acct_1',
      apiKey: 'codex-access',
      authMode: OPENAI_CODEX_AUTH_MODE,
    });

    const response = await runtime.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'gpt-5.4',
    });

    expect(response).toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer codex-access');
    expect(headers['chatgpt-account-id']).toBe('acct_1');
    expect(headers.originator).toBe('chathub');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-5.4',
      store: false,
      stream: true,
    });
  });
});
