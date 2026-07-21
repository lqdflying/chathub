import type { ChatHubRPCDiagnosticOperation } from '@lobechat/const';

import { TOOLS_DIAGNOSTIC_CONTEXT_KEY } from '@/const/tools';
import type { ToolsRPCResponseErrorDetails } from '@/libs/trpc/client/toolsResponse';

interface ClientRPCFailureMetadata {
  attempt?: number;
  diagnosticId: string;
  operation: 'call_tool' | ChatHubRPCDiagnosticOperation;
  procedure: 'mcp.callTool' | 'message.update';
  rpcEndpoint: 'lambda' | 'tools';
}

class RPCDiagnosticsService {
  reportClientRPCFailure(
    details: ToolsRPCResponseErrorDetails,
    metadata: ClientRPCFailureMetadata,
  ): void {
    void import('@/libs/trpc/client')
      .then(({ toolsClient }) =>
        toolsClient.mcp.reportClientFailure.mutate(
          { ...details, ...metadata, diagnosticId: metadata.diagnosticId },
          {
            context: { [TOOLS_DIAGNOSTIC_CONTEXT_KEY]: metadata.diagnosticId },
          },
        ),
      )
      .catch(() => undefined);
  }
}

export const rpcDiagnosticsService = new RPCDiagnosticsService();
