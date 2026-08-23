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
      body: JSON.stringify({
        correlation: { index: 0, messageId: 'message-1' },
        model: 'gpt-image-2',
        params: { prompt: 'a cat' },
        taskId: 'task-1',
      }),
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
      correlation: { index: 0, messageId: 'message-1' },
      model: 'gpt-image-2',
      params: { prompt: 'a cat' },
      provider: 'openaicompatible',
      taskId: 'task-1',
    });
    expect(createChatImage).toHaveBeenCalledTimes(1);
  });

  it('maps an unauthorized caller failure to an error response, not a 200', async () => {
    createChatImage.mockRejectedValue(
      Object.assign(new Error('UNAUTHORIZED'), { errorType: ChatErrorType.Unauthorized }),
    );

    const response = await POST(makeRequest({ [LOBE_CHAT_AUTH_HEADER]: 'encoded-payload' }), {
      params: Promise.resolve({ provider: 'openaicompatible' }),
    } as any);

    expect(response.ok).toBe(false);
  });

  it('re-encodes the authenticated payload for header-less bypass modes so keyVaults can decode it (R10-4)', async () => {
    createChatImage.mockResolvedValue({ taskId: 'task-2' });

    // checkAuth's dev/desktop bypass reaches the handler WITHOUT the client
    // header (the mock supplies only the decoded payload, like the bypass does)
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ provider: 'openaicompatible' }),
    } as any);

    expect(response.status).toBe(200);
    const forwarded = capturedContexts[0].authorizationHeader;
    expect(typeof forwarded).toBe('string');
    // the synthesized header round-trips through the REAL server-side decoder
    const { getXorPayload } = await import('@lobechat/utils/server');
    expect(getXorPayload(forwarded)).toMatchObject({ apiKey: 'user-key', userId: 'account-a' });
  });

  it('forwards the client task id and message correlation for server-side verification', async () => {
    createChatImage.mockResolvedValue({ taskId: 'client-uuid' });

    const request = new Request(
      'https://chathub.example/webapi/create-chat-image/openaicompatible',
      {
        body: JSON.stringify({
          correlation: { index: 2, messageId: 'message-1' },
          model: 'gpt-image-2',
          params: { prompt: 'a cat' },
          taskId: 'client-uuid',
        }),
        headers: { 'content-type': 'application/json', [LOBE_CHAT_AUTH_HEADER]: 'x' },
        method: 'POST',
      },
    );
    await POST(request, { params: Promise.resolve({ provider: 'openaicompatible' }) } as any);

    expect(createChatImage).toHaveBeenCalledWith(
      expect.objectContaining({
        correlation: { index: 2, messageId: 'message-1' },
        taskId: 'client-uuid',
      }),
    );
  });

  it('forwards a validated generation spanId and drops an invalid one', async () => {
    createChatImage.mockResolvedValue({ taskId: 'task-1' });

    const valid = new Request('https://chathub.example/webapi/create-chat-image/openaicompatible', {
      body: JSON.stringify({
        correlation: { index: 0, messageId: 'message-1' },
        model: 'gpt-image-2',
        params: { prompt: 'a cat' },
        spanId: 'gd_0123456789abcdef',
        taskId: 'task-1',
      }),
      headers: { 'content-type': 'application/json', [LOBE_CHAT_AUTH_HEADER]: 'x' },
      method: 'POST',
    });
    await POST(valid, { params: Promise.resolve({ provider: 'openaicompatible' }) } as any);

    expect(createChatImage).toHaveBeenCalledWith(
      expect.objectContaining({ spanId: 'gd_0123456789abcdef' }),
    );

    createChatImage.mockClear();
    const invalid = new Request(
      'https://chathub.example/webapi/create-chat-image/openaicompatible',
      {
        body: JSON.stringify({
          correlation: { index: 0, messageId: 'message-1' },
          model: 'gpt-image-2',
          params: { prompt: 'a cat' },
          spanId: 'not-a-span',
          taskId: 'task-1',
        }),
        headers: { 'content-type': 'application/json', [LOBE_CHAT_AUTH_HEADER]: 'x' },
        method: 'POST',
      },
    );
    await POST(invalid, { params: Promise.resolve({ provider: 'openaicompatible' }) } as any);

    expect(createChatImage).toHaveBeenCalledWith(
      expect.not.objectContaining({ spanId: expect.anything() }),
    );
  });
});
