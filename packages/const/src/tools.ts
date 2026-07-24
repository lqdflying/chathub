export const CHATHUB_TOOLS_DIAGNOSTIC_HEADER = 'x-chathub-tools-diagnostic-id';

export const CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN = /^td_[\w-]{8,48}$/;

export const CHATHUB_IMAGE_DIAGNOSTIC_HEADER = 'x-chathub-image-diagnostic-id';

export const CHATHUB_IMAGE_DIAGNOSTIC_ID_PATTERN = /^ig_[\w-]{8,48}$/;

export const CHATHUB_MCP_INVOCATION_ID_PATTERN = /^mi_[\w-]{20}$/;

export const CHATHUB_RPC_DIAGNOSTIC_OPERATION_HEADER = 'x-chathub-rpc-diagnostic-operation';

export const CHATHUB_RPC_DIAGNOSTIC_OPERATIONS = [
  'finalize_assistant_message',
  'persist_tool_result',
] as const;

export type ChatHubRPCDiagnosticOperation = (typeof CHATHUB_RPC_DIAGNOSTIC_OPERATIONS)[number];

export const TOOLS_DIAGNOSTIC_CONTEXT_KEY = 'toolsDiagnosticId';
