import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';

import { ToolTelemetryService, toolTelemetryService } from './toolTelemetry';

const { getStatus, reportToolBatch, reportToolCompletion } = vi.hoisted(() => ({
  getStatus: vi.fn(),
  reportToolBatch: vi.fn(),
  reportToolCompletion: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  toolsClient: {
    telemetry: {
      getStatus: { query: getStatus },
      reportToolBatch: { mutate: reportToolBatch },
      reportToolCompletion: { mutate: reportToolCompletion },
    },
  },
}));

describe('ToolTelemetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatus.mockResolvedValue({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: true,
    });
    reportToolBatch.mockResolvedValue({ reported: true });
  });

  it('caches successful capabilities within the refresh TTL', async () => {
    const service = new ToolTelemetryService();

    await expect(service.getCapabilities()).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: true,
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: true,
    });
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it('returns disabled capabilities promptly when discovery does not settle', async () => {
    vi.useFakeTimers();
    getStatus.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValueOnce({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: false,
    });
    const service = new ToolTelemetryService();
    const capabilityPromise = service.getCapabilities();

    await vi.advanceTimersByTimeAsync(250);

    await expect(capabilityPromise).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: false,
    });
    expect(getStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('retries capability discovery after a transient rejection', async () => {
    getStatus
      .mockRejectedValueOnce(new Error('temporary capability failure'))
      .mockResolvedValueOnce({
        cacheContinuationEnabled: true,
        toolLifecycleEnabled: false,
      });
    const service = new ToolTelemetryService();

    await expect(service.getCapabilities()).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: false,
    });
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('uses one valid deterministic transport ID for a batch lifecycle', async () => {
    const correlation = {
      batchId: 'tb_1234567890abcdef',
      continuationId: 'tc_1234567890abcdef',
      failureCount: 0,
      resultCount: 2,
      toolCallCount: 2,
      toolCallSetHash: 'fedcba9876543210',
    };

    await toolTelemetryService.reportToolBatch(correlation, 'started');
    await toolTelemetryService.reportToolBatch(correlation, 'settled');

    const startedOptions = reportToolBatch.mock.calls[0][1];
    const settledOptions = reportToolBatch.mock.calls[1][1];
    const startedDiagnosticId = startedOptions.context[TOOLS_DIAGNOSTIC_CONTEXT_KEY];
    const settledDiagnosticId = settledOptions.context[TOOLS_DIAGNOSTIC_CONTEXT_KEY];

    expect(reportToolBatch).toHaveBeenNthCalledWith(
      1,
      { correlation, phase: 'started' },
      expect.any(Object),
    );
    expect(reportToolBatch).toHaveBeenNthCalledWith(
      2,
      { correlation, phase: 'settled' },
      expect.any(Object),
    );
    expect(startedDiagnosticId).toMatch(/^td_[\da-f]{16}$/);
    expect(settledDiagnosticId).toBe(startedDiagnosticId);
    expect(startedDiagnosticId).not.toContain(correlation.batchId);
  });
});
