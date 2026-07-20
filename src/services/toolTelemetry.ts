import {
  ToolCallSetCorrelation,
  ToolDiagnosticRuntimeType,
  ToolDiagnosticTerminalOutcome,
  ToolResultDebugSummary,
  createToolResultDebugSummary,
} from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';

interface ReportToolCompletionInput {
  callIdHash: string;
  correlation: ToolCallSetCorrelation;
  diagnosticId: string;
  outcome: ToolDiagnosticTerminalOutcome;
  result: ToolResultDebugSummary;
  runtimeType: ToolDiagnosticRuntimeType;
  toolNameHash: string;
}

export interface ToolDiagnosticCapabilities {
  cacheContinuationEnabled: boolean;
  toolLifecycleEnabled: boolean;
}

const DEFAULT_TOOL_DIAGNOSTIC_CAPABILITIES: ToolDiagnosticCapabilities = {
  cacheContinuationEnabled: false,
  toolLifecycleEnabled: false,
};
const CAPABILITY_CACHE_TTL_MS = 30_000;
const CAPABILITY_REQUEST_TIMEOUT_MS = 250;

const createBatchTransportDiagnosticId = (correlation: ToolCallSetCorrelation): string => {
  const batchIdentity =
    correlation.batchId ?? `${correlation.toolCallSetHash}:${correlation.toolCallCount}`;
  return `td_${createToolResultDebugSummary(batchIdentity).valueHash}`;
};

export class ToolTelemetryService {
  private capabilityCache?: {
    capabilities: ToolDiagnosticCapabilities;
    expiresAt: number;
  };
  private capabilityRequest?: Promise<ToolDiagnosticCapabilities>;

  async getCapabilities(): Promise<ToolDiagnosticCapabilities> {
    if (this.capabilityCache && this.capabilityCache.expiresAt > Date.now()) {
      return this.capabilityCache.capabilities;
    }

    if (!this.capabilityRequest) {
      const abortController = new AbortController();
      const request = toolsClient.telemetry.getStatus
        .query(undefined, { signal: abortController.signal })
        .then((response) => {
          const capabilities: ToolDiagnosticCapabilities = {
            cacheContinuationEnabled: !!response.cacheContinuationEnabled,
            toolLifecycleEnabled: !!response.toolLifecycleEnabled,
          };
          this.capabilityCache = {
            capabilities,
            expiresAt: Date.now() + CAPABILITY_CACHE_TTL_MS,
          };
          return capabilities;
        })
        .catch(() => DEFAULT_TOOL_DIAGNOSTIC_CAPABILITIES);

      let timeout: ReturnType<typeof setTimeout>;
      const trackedRequest = request.finally(() => {
        clearTimeout(timeout);
        if (this.capabilityRequest === trackedRequest) {
          this.capabilityRequest = undefined;
        }
      });
      this.capabilityRequest = trackedRequest;
      timeout = setTimeout(() => {
        if (this.capabilityRequest !== trackedRequest) return;

        abortController.abort();
        this.capabilityRequest = undefined;
      }, CAPABILITY_REQUEST_TIMEOUT_MS);
    }

    return this.resolveWithinTimeout(
      this.capabilityRequest!,
      DEFAULT_TOOL_DIAGNOSTIC_CAPABILITIES,
      CAPABILITY_REQUEST_TIMEOUT_MS,
    );
  }

  async isEnabled(): Promise<boolean> {
    const { toolLifecycleEnabled } = await this.getCapabilities();
    return toolLifecycleEnabled;
  }

  private resolveWithinTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(fallback), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        () => {
          clearTimeout(timeout);
          resolve(fallback);
        },
      );
    });
  }

  reportToolBatch(
    correlation: ToolCallSetCorrelation,
    phase: 'settled' | 'started',
  ): Promise<{ reported: boolean }> {
    return toolsClient.telemetry.reportToolBatch.mutate(
      { correlation, phase },
      {
        context: {
          [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: createBatchTransportDiagnosticId(correlation),
        },
      },
    );
  }

  reportToolCompletion(input: ReportToolCompletionInput): Promise<{ reported: boolean }> {
    return toolsClient.telemetry.reportToolCompletion.mutate(input, {
      context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: input.diagnosticId },
    });
  }
}

export const toolTelemetryService = new ToolTelemetryService();
