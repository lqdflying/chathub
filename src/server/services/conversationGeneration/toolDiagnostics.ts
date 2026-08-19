import type {
  ToolCacheDebugMetadata,
  ToolCallSetCorrelation,
  ToolDiagnosticRuntimeType,
  ToolDiagnosticTerminalOutcome,
} from '@lobechat/types';
import { createToolCallSetCorrelation, createToolResultDebugSummary } from '@lobechat/types';

import { isToolsDebugEnabled, logToolsDebugSafe } from '@/libs/logger/toolsDebug';
import { MemoryManifest } from '@/tools/memory';
import { SkillLoaderManifest } from '@/tools/skills';
import { WebBrowsingManifest } from '@/tools/web-browsing';

export type ConversationToolBatchCorrelation = ToolCallSetCorrelation & {
  batchId: string;
  continuationId: string;
};

const BUILTIN_TOOL_IDENTIFIERS = new Set([
  MemoryManifest.identifier,
  SkillLoaderManifest.identifier,
  WebBrowsingManifest.identifier,
]);

export const resolveConversationToolRuntimeType = (
  identifier: string | undefined,
  isHttpMcp = false,
): ToolDiagnosticRuntimeType => {
  if (isHttpMcp) return 'mcp';
  if (identifier && BUILTIN_TOOL_IDENTIFIERS.has(identifier)) return 'builtin';
  return 'server';
};

export const createConversationToolBatchCorrelation = (
  toolCallIds: readonly (string | undefined)[],
  sequence: number,
  sessionScope?: string | null,
): ConversationToolBatchCorrelation => {
  const baseCorrelation = createToolCallSetCorrelation(toolCallIds);
  const batchFingerprint = createToolResultDebugSummary({
    callIdentifiers: [...new Set(toolCallIds.filter(Boolean) as string[])].sort(),
    sequence,
    sessionScope: sessionScope || 'none',
  }).valueHash.padEnd(20, '0');

  return {
    ...baseCorrelation,
    batchId: `tb_${batchFingerprint}`,
    continuationId: `tc_${batchFingerprint}`,
  };
};

export const toConversationToolCacheMetadata = (
  correlation: ConversationToolBatchCorrelation & {
    failureCount: number;
    resultCount: number;
  },
): ToolCacheDebugMetadata => ({
  batchId: correlation.batchId,
  continuationId: correlation.continuationId,
  failureCount: correlation.failureCount,
  resultCount: correlation.resultCount,
  toolCallCount: correlation.toolCallCount,
  toolCallSetHash: correlation.toolCallSetHash,
});

export const reportConversationToolBatch = (
  correlation: ConversationToolBatchCorrelation & {
    failureCount?: number;
    resultCount?: number;
  },
  phase: 'settled' | 'started',
) => {
  if (!isToolsDebugEnabled()) return;

  logToolsDebugSafe(phase === 'started' ? 'tool_batch_started' : 'tool_batch_settled', {
    ...correlation,
    phase,
    runtimeType: 'server',
  });
};

export const reportConversationToolCompletion = ({
  correlation,
  identifier,
  isHttpMcp,
  outcome,
  toolCallId,
}: {
  correlation: ConversationToolBatchCorrelation;
  identifier?: string;
  isHttpMcp?: boolean;
  outcome: ToolDiagnosticTerminalOutcome;
  toolCallId?: string;
}) => {
  if (!isToolsDebugEnabled()) return;

  const callIdHash = createToolResultDebugSummary(toolCallId || 'server-tool-call').valueHash;
  const diagnosticId = `td_${createToolResultDebugSummary({
    batchId: correlation.batchId,
    callId: toolCallId || 'server-tool-call',
  }).valueHash}`;
  const toolNameHash = createToolResultDebugSummary(identifier || 'server-tool').valueHash;

  logToolsDebugSafe('tool_completion_reported', {
    ...correlation,
    callIdHash,
    diagnosticId,
    outcome,
    runtimeType: resolveConversationToolRuntimeType(identifier, isHttpMcp),
    toolNameHash,
  });
};
