// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuth } from '@/app/(backend)/middleware/auth/utils';
import { LOBE_CHAT_AUTH_HEADER, OAUTH_AUTHORIZED } from '@/const/auth';
import { createErrorResponse } from '@/utils/errorResponse';

import { POST } from './route';

const gatewayHandler = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

vi.mock('@lobehub/chat-plugins-gateway', () => ({
  createGatewayOnEdgeRuntime: vi.fn(() => gatewayHandler),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  resolveWebApiAuth: vi.fn(),
}));

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/envs/app', () => ({
  getAppConfig: vi.fn(() => ({
    ACCESS_CODES: [],
    PLUGINS_INDEX_URL: 'https://plugins.example.com',
    PLUGIN_SETTINGS: '',
  })),
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(() => ({
    createTrace: vi.fn(),
  })),
}));

vi.mock('@/utils/errorResponse', () => ({
  createErrorResponse: vi.fn((errorType: number) =>
    Response.json({ errorType }, { status: errorType }),
  ),
}));

vi.mock('@/utils/trace', () => ({
  getTracePayload: vi.fn(),
}));

vi.mock('./settings', () => ({
  parserPluginSettings: vi.fn(),
}));

describe('plugin gateway authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getXorPayload).mockReturnValue({ accessCode: 'payload-access-code' });
    gatewayHandler.mockResolvedValue(new Response('gateway response'));
  });

  it('rejects a forged OAuth marker before invoking the gateway', async () => {
    const unauthorized = AgentRuntimeError.createError(ChatErrorType.Unauthorized);
    vi.mocked(resolveWebApiAuth).mockRejectedValue(unauthorized);
    const request = new Request('https://example.com/webapi/plugin/gateway', {
      body: JSON.stringify({ manifest: {}, parameters: {} }),
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
        [OAUTH_AUTHORIZED]: 'true',
      },
      method: 'POST',
    });

    const response = await POST(request);

    expect(resolveWebApiAuth).toHaveBeenCalledWith(request, {
      accessCode: 'payload-access-code',
    });
    expect(createErrorResponse).toHaveBeenCalledWith(ChatErrorType.Unauthorized, unauthorized);
    expect(gatewayHandler).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it('invokes the gateway after direct server authentication succeeds', async () => {
    vi.mocked(resolveWebApiAuth).mockResolvedValue({
      method: 'nextAuth',
      userId: 'session-owner',
    });
    const request = new Request('https://example.com/webapi/plugin/gateway', {
      body: JSON.stringify({ manifest: {}, parameters: {} }),
      headers: {
        [LOBE_CHAT_AUTH_HEADER]: 'encrypted-payload',
      },
      method: 'POST',
    });

    const response = await POST(request);

    expect(gatewayHandler).toHaveBeenCalledWith(request);
    expect(await response.text()).toBe('gateway response');
  });
});
