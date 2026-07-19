import {
  ToolCallSetCorrelation,
  ToolResultDebugSummary,
} from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';
import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/libs/trpc/client/tools';

interface ReportToolCompletionInput {
  correlation: ToolCallSetCorrelation;
  diagnosticId: string;
  result: ToolResultDebugSummary;
  runtimeType: 'builtin' | 'mcp';
  toolNameHash: string;
}

class ToolTelemetryService {
  reportToolCompletion(input: ReportToolCompletionInput): Promise<{ reported: boolean }> {
    return toolsClient.telemetry.reportToolCompletion.mutate(input, {
      context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: input.diagnosticId },
    });
  }
}

export const toolTelemetryService = new ToolTelemetryService();
