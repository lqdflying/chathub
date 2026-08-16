// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOBE_CHAT_AUTH_HEADER } from '@/const/auth';

import { POST } from './route';

const { capturedContexts, createChatImage } = vi.hoisted(() => ({
  capturedContexts: [] as any[],
  createChatImage: vi.fn(),
}));

// pass-through auth: hand the handler a decoded payload like checkAuth would
vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth:
    (handler: any) =>
    async (req: Request, options: any = {}) =>
      handler(req, {
        jwtPayload: { apiKey: 'user-key', userId: 'account-a' },
        params: options.params,
      }),
}));

vi.mock('@/libs/trpc/lambda', () => ({
  createCallerFactory: () => (ctx: any) => {
    capturedContexts.push(ctx);
    return { image: { createChatImage } };
  },
}));

vi.mock('@/server/routers/lambda', () => ({ lambdaRouter: {} }));

describe('POST /webapi/create-chat-image/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedContexts.length = 0;
  });

  const makeRequest = (headers?: Record<string, string>) =>
    new Request('https://chathub.example/webapi/create-chat-image/openaicompatible', {
      body: JSON.stringify({ model: 'gpt-image-2', params: { prompt: 'a cat' } }),
      headers: { 'content-type': 'application/json', ...headers },
      method: 'POST',
    });

  it('forwards the RAW provider auth header into the caller context and returns the task id (R9-1)', async () => {
    createChatImage.mockResolvedValue({ taskId: 'task-1' });

    const response = await POST(makeRequest({ [LOBE_CHAT_AUTH_HEADER]: 'encoded-payload' }), {
      params: Promise.resolve({ provider: 'openaicompatible' }),
    } as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: 'task-1' });
    // the image procedures run the keyVaults middleware, which decodes
    // ctx.authorizationHeader itself — dropping it made EVERY request 401
    expect(capturedContexts[0].authorizationHeader).toBe('encoded-payload');
    expect(capturedContexts[0].userId).toBe('account-a');
    expect(createChatImage).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      params: { prompt: 'a cat' },
      provider: 'openaicompatible',
    });
    expect(createChatImage).toHaveBeenCalledTimes(1);
  });

  it('maps an unauthorized caller failure to an error response, not a 200', async () => {
    createChatImage.mockRejectedValue(
      Object.assign(new Error('UNAUTHORIZED'), { errorType: ChatErrorType.Unauthorized }),
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ provider: 'openaicompatible' }),
    } as any);

    expect(response.ok).toBe(false);
    // missing header is forwarded as null — the middleware decides, the route
    // never fabricates an authorization value
    expect(capturedContexts[0].authorizationHeader).toBeNull();
  });
});
