import { isServerMode } from '@lobechat/const';
import { z } from 'zod';

import {
  hasModelCacheFingerprintKey,
  isAnyModelCacheDebugEnabled,
  protectExternalToolCacheDebugMetadata,
  protectExternalToolsDiagnosticId,
} from '@/libs/logger/modelCacheDebug';
import { isToolsDebugEnabled, logToolsDebugSafe } from '@/libs/logger/toolsDebug';
import { passwordProcedure } from '@/libs/trpc/edge';
import { authedProcedure, router } from '@/libs/trpc/lambda';

const telemetryProcedure = isServerMode ? authedProcedure : passwordProcedure;
const hashSchema = z.string().regex(/^[\da-f]{16}$/);
const batchIdSchema = z.string().regex(/^tb_[\w-]{12,80}$/);
const continuationIdSchema = z.string().regex(/^tc_[\w-]{12,80}$/);
const runtimeTypeSchema = z.enum([
  'builtin',
  'default',
  'delegated',
  'markdown',
  'mcp',
  'server',
  'standalone',
]);
const terminalOutcomeSchema = z.enum([
  'cancelled',
  'completed',
  'failed',
  'handed_off',
  'persistence_failed',
  'skipped',
]);
const correlationSchema = z.object({
  batchId: batchIdSchema.optional(),
  continuationId: continuationIdSchema.optional(),
  failureCount: z.number().int().nonnegative().max(100).optional(),
  resultCount: z.number().int().nonnegative().max(100).optional(),
  toolCallCount: z.number().int().positive().max(100),
  toolCallSetHash: hashSchema,
});
const resultSummarySchema = z.object({
  itemCount: z.number().int().nonnegative().optional(),
  propertyCount: z.number().int().nonnegative().optional(),
  serializedLength: z.number().int().nonnegative().max(100_000_000),
  truncated: z.boolean().optional(),
  type: z.enum([
    'array',
    'bigint',
    'boolean',
    'function',
    'null',
    'number',
    'object',
    'string',
    'symbol',
    'undefined',
  ]),
  valueHash: hashSchema,
});

export const telemetryRouter = router({
  getStatus: telemetryProcedure.query(() => ({
    cacheContinuationEnabled: isAnyModelCacheDebugEnabled() && hasModelCacheFingerprintKey(),
    toolLifecycleEnabled: !!isToolsDebugEnabled(),
  })),
  reportToolBatch: telemetryProcedure
    .input(
      z.object({
        correlation: correlationSchema,
        phase: z.enum(['settled', 'started']),
      }),
    )
    .mutation(({ input }) => {
      const protectedCorrelation = protectExternalToolCacheDebugMetadata(input.correlation);
      logToolsDebugSafe(
        input.phase === 'started' ? 'tool_batch_started' : 'tool_batch_settled',
        protectedCorrelation ?? {
          failureCount: input.correlation.failureCount,
          resultCount: input.correlation.resultCount,
          toolCallCount: input.correlation.toolCallCount,
          toolCallSetHash: input.correlation.toolCallSetHash,
        },
      );

      return { reported: true };
    }),
  reportToolCompletion: telemetryProcedure
    .input(
      z.object({
        callIdHash: hashSchema,
        correlation: correlationSchema,
        diagnosticId: z.string().regex(/^td_[\w-]{12,80}$/),
        outcome: terminalOutcomeSchema,
        result: resultSummarySchema,
        runtimeType: runtimeTypeSchema,
        toolNameHash: hashSchema,
      }),
    )
    .mutation(({ input }) => {
      const protectedCorrelation = protectExternalToolCacheDebugMetadata(input.correlation);
      logToolsDebugSafe('tool_completion_reported', {
        ...(protectedCorrelation ?? {
          failureCount: input.correlation.failureCount,
          resultCount: input.correlation.resultCount,
          toolCallCount: input.correlation.toolCallCount,
          toolCallSetHash: input.correlation.toolCallSetHash,
        }),
        callIdHash: input.callIdHash,
        diagnosticId: protectExternalToolsDiagnosticId(input.diagnosticId),
        outcome: input.outcome,
        result: input.result,
        runtimeType: input.runtimeType,
        toolNameHash: input.toolNameHash,
      });

      return { reported: true };
    }),
});
