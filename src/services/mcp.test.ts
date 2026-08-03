import { ChatToolPayload } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolsRPCResponseError } from '@/libs/trpc/client/toolsResponse';

import { mcpService } from './mcp';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  recoverToolResult: vi.fn(),
  reportClientRPCFailure: vi.fn(),
  reportPluginCall: vi.fn(),
}));

vi.mock('nanoid', () => ({
  nanoid: () => '12345678901234567890',
}));

vi.mock('@/libs/trpc/client', () => ({
  toolsClient: {
    mcp: {
      callTool: { mutate: mocks.callTool },
      recoverToolResult: { mutate: mocks.recoverToolResult },
    },
  },
}));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => (state: { installedPlugin: unknown }) => state.installedPlugin,
  },
}));

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => ({
    installedPlugin: {
      customParams: {
        mcp: {
          auth: { type: 'none' },
          type: 'http',
          url: 'https://mcp.example.com',
        },
      },
      identifier: 'tavily',
      manifest: { version: '1.0.0' },
    },
  }),
}));

vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: mocks.reportPluginCall,
  },
}));

vi.mock('./rpcDiagnostics', () => ({
  rpcDiagnosticsService: {
    reportClientRPCFailure: mocks.reportClientRPCFailure,
  },
}));

const payload = {
  apiName: 'tavily_search',
  arguments: '{"query":"test"}',
  identifier: 'tavily',
  type: 'mcp',
} as ChatToolPayload;

describe('MCPService result recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reportPluginCall.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers a server-persisted result after the call response is lost', async () => {
    const responseError = new ToolsRPCResponseError({
      bodyKind: 'network_error',
      durationMs: 125,
      failurePhase: 'network',
      networkErrorKind: 'type_error',
      reason: 'network_error',
    });
    const persistedResult = {
      content: '{"answer":"persisted"}',
      persistence: 'persisted' as const,
    };
    mocks.callTool.mockRejectedValue(responseError);
    mocks.recoverToolResult.mockResolvedValue(persistedResult);

    await expect(
      mcpService.invokeMcpToolCall(payload, {
        diagnosticId: 'td_12345678901234567890',
        messageId: 'tool-message-id',
      }),
    ).resolves.toEqual(persistedResult);

    expect(mocks.callTool).toHaveBeenCalledTimes(1);
    expect(mocks.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationId: 'mi_12345678901234567890',
        messageId: 'tool-message-id',
      }),
      expect.any(Object),
    );
    expect(mocks.recoverToolResult).toHaveBeenCalledWith(
      {
        invocationId: 'mi_12345678901234567890',
        messageId: 'tool-message-id',
      },
      expect.any(Object),
    );
    expect(mocks.reportClientRPCFailure).toHaveBeenCalledTimes(1);
  });

  it('retries recovery after 500 ms when the persisted result is initially pending', async () => {
    vi.useFakeTimers();
    const responseError = new ToolsRPCResponseError({
      bodyKind: 'network_error',
      durationMs: 125,
      failurePhase: 'network',
      networkErrorKind: 'type_error',
      reason: 'network_error',
    });
    const persistedResult = {
      content: '{"answer":"persisted"}',
      persistence: 'persisted' as const,
    };
    mocks.callTool.mockRejectedValue(responseError);
    mocks.recoverToolResult.mockResolvedValueOnce(null).mockResolvedValueOnce(persistedResult);

    const invocationPromise = mcpService.invokeMcpToolCall(payload, {
      messageId: 'tool-message-id',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.recoverToolResult).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.recoverToolResult).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(invocationPromise).resolves.toEqual(persistedResult);
    expect(mocks.recoverToolResult).toHaveBeenCalledTimes(2);
  });

  it('retries recovery after one transient recovery request failure', async () => {
    vi.useFakeTimers();
    const responseError = new ToolsRPCResponseError({
      bodyKind: 'network_error',
      durationMs: 125,
      failurePhase: 'network',
      networkErrorKind: 'type_error',
      reason: 'network_error',
    });
    const persistedResult = {
      content: '{"answer":"persisted"}',
      persistence: 'persisted' as const,
    };
    mocks.callTool.mockRejectedValue(responseError);
    mocks.recoverToolResult
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(persistedResult);

    const invocationPromise = mcpService.invokeMcpToolCall(payload, {
      messageId: 'tool-message-id',
    });
    await vi.advanceTimersByTimeAsync(500);

    await expect(invocationPromise).resolves.toEqual(persistedResult);
    expect(mocks.recoverToolResult).toHaveBeenCalledTimes(2);
  });

  it('stops recovery when the invocation is cancelled during the recovery delay', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const responseError = new ToolsRPCResponseError({
      bodyKind: 'network_error',
      durationMs: 125,
      failurePhase: 'network',
      networkErrorKind: 'type_error',
      reason: 'network_error',
    });
    mocks.callTool.mockRejectedValue(responseError);
    mocks.recoverToolResult.mockResolvedValue(null);

    const invocationPromise = mcpService.invokeMcpToolCall(payload, {
      messageId: 'tool-message-id',
      signal: abortController.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    abortController.abort();

    await expect(invocationPromise).rejects.toBe(abortController.signal.reason);
    expect(mocks.recoverToolResult).toHaveBeenCalledTimes(1);
  });

  it('preserves a signal-driven Load failed cancellation without recovery', async () => {
    const abortController = new AbortController();
    const cancellationError = new TypeError('Load failed');
    abortController.abort();
    mocks.callTool.mockRejectedValue(cancellationError);

    await expect(
      mcpService.invokeMcpToolCall(payload, {
        messageId: 'tool-message-id',
        signal: abortController.signal,
      }),
    ).rejects.toBe(cancellationError);

    expect(mocks.recoverToolResult).not.toHaveBeenCalled();
    expect(mocks.reportClientRPCFailure).not.toHaveBeenCalled();
  });
});
