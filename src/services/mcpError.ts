import type { ChatMessageError } from '@lobechat/types';
import { PluginErrorType } from '@lobehub/chat-plugin-sdk';

import type { ToolsRPCResponseErrorDetails } from '@/libs/trpc/client/toolsResponse';

export interface MCPInvocationErrorDetails
  extends Partial<Omit<ToolsRPCResponseErrorDetails, 'diagnosticId' | 'failurePhase'>> {
  category: 'gateway' | 'server';
  diagnosticId: string;
  errorKind:
    | 'network_error'
    | 'response_parse_failed'
    | 'response_read_failed'
    | 'server_error'
    | 'unknown_error';
  failurePhase?: ToolsRPCResponseErrorDetails['failurePhase'] | 'rpc_server';
  trpcCode?: string;
}

export class MCPInvocationError extends Error {
  readonly code = 'CHATHUB_MCP_INVOCATION_ERROR';
  readonly details: MCPInvocationErrorDetails;

  constructor(details: MCPInvocationErrorDetails) {
    super('The MCP tool invocation failed.');
    this.name = 'MCPInvocationError';
    this.details = details;
  }
}

export const findMCPInvocationError = (error: unknown): MCPInvocationError | undefined => {
  if (error instanceof MCPInvocationError) return error;
  if (
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'CHATHUB_MCP_INVOCATION_ERROR' &&
    'details' in error
  ) {
    return error as MCPInvocationError;
  }
  return undefined;
};

export const createMCPChatMessageError = (
  error: unknown,
  translate: (type: string) => string,
): ChatMessageError => {
  const invocationError = findMCPInvocationError(error);
  const type =
    invocationError?.details.category === 'gateway'
      ? PluginErrorType.PluginGatewayError
      : PluginErrorType.PluginServerError;

  return {
    body: invocationError?.details || { errorKind: 'unknown_error' },
    message: translate(type),
    type,
  };
};
