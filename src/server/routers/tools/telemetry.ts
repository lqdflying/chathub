import { isServerMode } from '@lobechat/const';
import { z } from 'zod';

import { logToolsDebugSafe } from '@/libs/logger/toolsDebug';
import { passwordProcedure } from '@/libs/trpc/edge';
import { authedProcedure, router } from '@/libs/trpc/lambda';

const telemetryProcedure = isServerMode ? authedProcedure : passwordProcedure;
const hashSchema = z.string().regex(/^[\da-f]{16}$/);
const resultSummarySchema = z.object({
  itemCount: z.number().int().nonnegative().optional(),
  propertyCount: z.number().int().nonnegative().optional(),
  serializedLength: z.number().int().nonnegative().max(100_000_000),
  truncated: z.boolean().optional(),
  type: z.enum(['array', 'bigint', 'boolean', 'function', 'null', 'number', 'object', 'string', 'symbol', 'undefined']),
  valueHash: hashSchema,
});

export const telemetryRouter = router({
  reportToolCompletion: telemetryProcedure
    .input(
      z.object({
        correlation: z.object({
          toolCallCount: z.number().int().positive().max(100),
          toolCallSetHash: hashSchema,
        }),
        diagnosticId: z.string().regex(/^td_[\w-]{12,80}$/),
        result: resultSummarySchema,
        runtimeType: z.enum(['builtin', 'mcp']),
        toolNameHash: hashSchema,
      }),
    )
    .mutation(({ input }) => {
      logToolsDebugSafe('tool_completion_reported', {
        ...input.correlation,
        diagnosticId: input.diagnosticId,
        result: input.result,
        runtimeType: input.runtimeType,
        toolNameHash: input.toolNameHash,
      });

      return { reported: true };
    }),
});
