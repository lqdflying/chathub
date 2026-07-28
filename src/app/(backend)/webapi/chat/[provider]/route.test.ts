// @vitest-environment node
import { LOBE_CHAT_CONTEXT_EXPORT_HEADER } from '@lobechat/const';
import { LobeRuntimeAI, ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuth } from '@/app/(backend)/middleware/auth/utils';
import { LOBE_CHAT_AUTH_HEADER } from '@/const/auth';

import { POST } from './route';
import { resolveTrustedCatalogModel } from './trustedCatalogModel';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  resolveWebApiAuth: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(),
}));

vi.mock('./trustedCatalogModel', () => ({
  resolveTrustedCatalogModel: vi.fn(),
}));

// 定义一个变量来存储 enableAuth 的值
let enableClerk = false;

// 模拟 @/const/auth 模块
vi.mock('@/const/auth', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    get enableClerk() {
      return enableClerk;
    },
  };
});

// 模拟请求和响应
let request: Request;
beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    body: JSON.stringify({ model: 'test-model' }),
    headers: {
      [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token',
    },
    method: 'POST',
  });
  vi.mocked(resolveWebApiAuth).mockResolvedValue({ method: 'none' });
});

afterEach(() => {
  // 清除模拟调用历史
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  enableClerk = false;
});

describe('POST handler', () => {
  describe('init chat model', () => {
    it('should initialize ModelRuntime correctly with valid authorization', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });

      // 设置 getJWTPayload 和 initModelRuntimeWithUserPayload 的模拟返回值
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
      });

      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: vi.fn() };

      // migrate to new ModelRuntime init api
      const spy = vi
        .spyOn(ModelRuntime, 'initializeWithProvider')
        .mockResolvedValue(new ModelRuntime(mockRuntime));

      // 调用 POST 函数
      await POST(request as unknown as Request, { params: mockParams });

      // 验证是否正确调用了模拟函数
      expect(getXorPayload).toHaveBeenCalledWith('Bearer some-valid-token');
      expect(spy).toHaveBeenCalledWith('test-provider', expect.anything());
    });

    it('should return Unauthorized error when LOBE_CHAT_AUTH_HEADER is missing', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const requestWithoutAuthHeader = new Request(new URL('https://test.com'), {
        body: JSON.stringify({ model: 'test-model' }),
        method: 'POST',
      });

      const response = await POST(requestWithoutAuthHeader, { params: mockParams });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        body: {
          error: { errorType: 401 },
          provider: 'test-provider',
        },
        errorType: 401,
      });
    });

    it('should pass Clerk authentication resolved at the WebAPI boundary', async () => {
      enableClerk = true;

      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      vi.mocked(resolveWebApiAuth).mockResolvedValueOnce({
        method: 'clerk',
        userId: 'clerk-user',
      });

      const mockRuntime: LobeRuntimeAI = { baseURL: 'abc', chat: vi.fn() };

      vi.spyOn(ModelRuntime, 'initializeWithProvider').mockResolvedValue(
        new ModelRuntime(mockRuntime),
      );

      const request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({ model: 'test-model' }),
        headers: {
          [LOBE_CHAT_AUTH_HEADER]: 'some-valid-token',
        },
        method: 'POST',
      });

      await POST(request, { params: mockParams });

      expect(resolveWebApiAuth).toBeCalledWith(request, {
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
      });
    });

    it('should return InternalServerError error when throw a unknown error', async () => {
      const mockParams = Promise.resolve({ provider: 'test-provider' });
      vi.mocked(getXorPayload).mockImplementationOnce(() => {
        throw new Error('unknown error');
      });

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          error: {},
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });
  });

  describe('chat', () => {
    it('should correctly handle chat completion with valid payload', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
        userId: 'abc',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = {
        catalogModel: 'gpt-5.6-sol',
        message: 'Hello, world!',
        provider: 'client-controlled-provider',
      };
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify(mockChatPayload),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      const mockChatResponse: any = { message: 'Reply from agent', success: true };

      vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue(mockChatResponse);

      const response = await POST(request as unknown as Request, { params: mockParams });

      expect(response).toEqual(mockChatResponse);
      expect(ModelRuntime.prototype.chat).toHaveBeenCalledWith(
        { message: 'Hello, world!' },
        {
          runtimeProvider: 'test-provider',
          signal: expect.anything(),
          user: 'abc',
        },
      );
    });

    it('should strip legacy provider params before calling runtime', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
        userId: 'abc',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          frequency_penalty: 0.5,
          message: 'Hello, world!',
          presence_penalty: 0.3,
          temperature: 0.7,
          top_p: 0.9,
        }),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      const mockChatResponse: any = { message: 'Reply from agent', success: true };

      vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue(mockChatResponse);

      await POST(request as unknown as Request, { params: mockParams });

      expect(ModelRuntime.prototype.chat).toHaveBeenCalledWith(
        { message: 'Hello, world!' },
        {
          runtimeProvider: 'test-provider',
          signal: expect.anything(),
          user: 'abc',
        },
      );
    });

    it('passes only a server-validated Azure catalog model to the runtime', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        runtimeProvider: 'azure',
        userId: 'test-user',
      });
      vi.mocked(resolveTrustedCatalogModel).mockResolvedValueOnce('gpt-5.6-sol');
      const chatSpy = vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue({
        success: true,
      } as any);
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          catalogModel: 'gpt-5.6-sol',
          messages: [{ content: 'private prompt', role: 'user' }],
          model: 'custom-production-deployment',
        }),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      await POST(request, { params: Promise.resolve({ provider: 'azure' }) });

      expect(resolveTrustedCatalogModel).toHaveBeenCalledWith({
        catalogModel: 'gpt-5.6-sol',
        deploymentName: 'custom-production-deployment',
        runtimeProvider: 'azure',
        userId: 'test-user',
      });
      const [runtimePayload, runtimeOptions] = chatSpy.mock.calls[0];
      expect(runtimePayload).not.toHaveProperty('catalogModel');
      expect(runtimeOptions).toMatchObject({
        runtimeProvider: 'azure',
        trustedCatalogModel: 'gpt-5.6-sol',
      });
    });

    it('does not forward an unvalidated Azure catalog model', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        runtimeProvider: 'azure',
        userId: 'test-user',
      });
      vi.mocked(resolveTrustedCatalogModel).mockResolvedValueOnce(undefined);
      const chatSpy = vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue({
        success: true,
      } as any);
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          catalogModel: 'gpt-5.6-sol',
          messages: [{ content: 'private prompt', role: 'user' }],
          model: 'attacker-selected-deployment',
        }),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      await POST(request, { params: Promise.resolve({ provider: 'azure' }) });

      const [runtimePayload, runtimeOptions] = chatSpy.mock.calls[0];
      expect(runtimePayload).not.toHaveProperty('catalogModel');
      expect(runtimeOptions).not.toHaveProperty('trustedCatalogModel');
    });

    it('continues Azure chat when trusted catalog resolution rejects', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        apiKey: 'test-api-key',
        runtimeProvider: 'azure',
        userId: 'test-user',
      });
      vi.mocked(resolveTrustedCatalogModel).mockRejectedValueOnce(
        new Error('optional catalog lookup failed'),
      );
      const chatSpy = vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue({
        success: true,
      } as any);
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          catalogModel: 'gpt-5.6-sol',
          messages: [{ content: 'private prompt', role: 'user' }],
          model: 'custom-production-deployment',
        }),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      const response = await POST(request, { params: Promise.resolve({ provider: 'azure' }) });

      expect(response).toEqual({ success: true });
      expect(chatSpy).toHaveBeenCalledOnce();
      const [runtimePayload, runtimeOptions] = chatSpy.mock.calls[0];
      expect(runtimePayload).not.toHaveProperty('catalogModel');
      expect(runtimeOptions).not.toHaveProperty('trustedCatalogModel');
    });

    it('moves sanitized continuation metadata into runtime options for every provider', async () => {
      vi.stubEnv('DEBUG_ANTHROPIC_CACHE', '1');
      vi.stubEnv('NEXT_AUTH_SECRET', 'test-deployment-fingerprint-secret');
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        runtimeProvider: 'anthropic',
        userId: 'test-user',
      });
      const chatSpy = vi.spyOn(ModelRuntime.prototype, 'chat').mockResolvedValue({
        success: true,
      } as any);
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          debugToolCache: {
            attackerControlled: 'PRIVATE_ATTACKER_VALUE',
            batchId: 'tb_1234567890abcdefghij',
            cachePolicy: {
              cacheControl: true,
              nestedAttackerControlled: 'PRIVATE_POLICY_VALUE',
            },
            continuationId: 'tc_1234567890abcdefghij',
            failureCount: 0,
            resultCount: 1,
            toolCallCount: 1,
            toolCallSetHash: '0123456789abcdef',
          },
          messages: [{ content: 'private prompt', role: 'user' }],
          model: 'claude-test-model',
        }),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      await POST(request, { params: Promise.resolve({ provider: 'anthropic' }) });

      const [runtimePayload, runtimeOptions] = chatSpy.mock.calls[0];
      expect(runtimePayload).toEqual({
        messages: [{ content: 'private prompt', role: 'user' }],
        model: 'claude-test-model',
      });
      expect(runtimePayload).not.toHaveProperty('debugToolCache');
      const protectedBatchId = runtimeOptions?.cacheDiagnostics?.toolCache?.batchId;
      const protectedContinuationId = runtimeOptions?.cacheDiagnostics?.toolCache?.continuationId;
      expect(runtimeOptions).toMatchObject({
        cacheDiagnostics: {
          continuation: {
            batchId: expect.stringMatching(/^tb_[\da-f]{32}$/),
            continuationId: expect.stringMatching(/^tc_[\da-f]{32}$/),
            expectedToolCallCount: 1,
            resultCount: 1,
          },
          provider: 'anthropic',
          runtimeFamily: 'anthropic',
          toolCache: {
            batchId: expect.stringMatching(/^tb_[\da-f]{32}$/),
            continuationId: expect.stringMatching(/^tc_[\da-f]{32}$/),
            failureCount: 0,
            resultCount: 1,
            toolCallCount: 1,
            toolCallSetHash: '0123456789abcdef',
          },
        },
        runtimeProvider: 'anthropic',
        trustedPromptCacheKey: expect.stringMatching(/^ch_[\da-f]{32}$/),
        user: 'test-user',
      });
      expect(runtimeOptions?.cacheDiagnostics?.toolCache).not.toHaveProperty('attackerControlled');
      expect(runtimeOptions?.cacheDiagnostics?.toolCache?.cachePolicy).toEqual({});
      expect(runtimeOptions?.cacheDiagnostics?.continuation?.batchId).toBe(protectedBatchId);
      expect(runtimeOptions?.cacheDiagnostics?.continuation?.continuationId).toBe(
        protectedContinuationId,
      );
      expect(protectedBatchId).not.toBe('tb_1234567890abcdefghij');
      expect(protectedContinuationId).not.toBe('tc_1234567890abcdefghij');
    });

    it('should return an error response when chat completion fails', async () => {
      // 设置 getJWTPayload 和 initAgentRuntimeWithUserPayload 的模拟返回值
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        azureApiVersion: 'v1',
      });

      const mockParams = Promise.resolve({ provider: 'test-provider' });
      const mockChatPayload = { message: 'Hello, world!' };
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify(mockChatPayload),
        headers: { [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token' },
        method: 'POST',
      });

      const mockErrorResponse = {
        errorMessage: 'Something went wrong',
        errorType: ChatErrorType.InternalServerError,
      };

      vi.spyOn(ModelRuntime.prototype, 'chat').mockRejectedValue(mockErrorResponse);

      const response = await POST(request, { params: mockParams });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        body: {
          error: {
            errorMessage: 'Something went wrong',
            errorType: 500,
          },
          errorMessage: 'Something went wrong',
          provider: 'test-provider',
        },
        errorType: 500,
      });
    });

    it('returns a sanitized prepared request when the provider rejects eagerly', async () => {
      vi.mocked(getXorPayload).mockReturnValueOnce({
        accessCode: 'test-access-code',
        apiKey: 'test-api-key',
        runtimeProvider: 'openai',
        userId: 'authenticated-user',
      });

      const contextExportRequest = {
        captureId: 'capture-1',
        continuationReason: 'initial',
        purpose: 'assistant',
        requestId: 'request-1',
        sequence: 0,
      };
      request = new Request(new URL('https://test.com'), {
        body: JSON.stringify({
          messages: [{ content: 'Hello, world!', role: 'user' }],
          model: 'test-model',
        }),
        headers: {
          [LOBE_CHAT_AUTH_HEADER]: 'Bearer some-valid-token',
          [LOBE_CHAT_CONTEXT_EXPORT_HEADER]: JSON.stringify(contextExportRequest),
        },
        method: 'POST',
      });

      vi.spyOn(ModelRuntime.prototype, 'chat').mockImplementationOnce(
        async (_payload, options) => {
          options?.onRequestPrepared?.(
            {
              messages: [{ content: 'Hello, world!', role: 'user' }],
              model: 'test-model',
              prompt_cache_key: 'private-cache-key',
              user: 'authenticated-user',
            },
            { apiMode: 'chatCompletion' },
          );

          throw {
            error: { message: 'Provider rejected request' },
            errorType: ChatErrorType.InternalServerError,
          };
        },
      );

      const response = await POST(request, {
        params: Promise.resolve({ provider: 'test-provider' }),
      });
      const responseBody = await response.json();

      expect(response.status).toBe(500);
      expect(responseBody.body.contextExportSnapshot).toMatchObject({
        ...contextExportRequest,
        error: 'Provider request rejected: 500',
        metadata: {
          apiMode: 'chatCompletion',
          model: 'test-model',
          provider: 'test-provider',
          runtime: 'openai',
        },
        providerRequest: {
          messages: [{ content: 'Hello, world!', role: 'user' }],
          model: 'test-model',
        },
        status: 'error',
      });
      expect(responseBody.body.contextExportSnapshot.providerRequest).not.toHaveProperty('user');
      expect(responseBody.body.contextExportSnapshot.providerRequest).not.toHaveProperty(
        'prompt_cache_key',
      );
    });
  });
});
