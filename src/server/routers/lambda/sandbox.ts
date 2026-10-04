import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { invokeSandboxTool } from '@/server/services/sandbox';

const sandboxProcedure = authedProcedure.use(serverDatabase);

export const sandboxRouter = router({
  // Per-API arguments are validated by the Sandbox tool service.
  invoke: sandboxProcedure
    .input(
      z.object({
        apiName: z.string().min(1).max(64),
        arguments: z.record(z.unknown()),
        groupId: z.string().max(128).nullish(),
        sessionId: z.string().max(128).nullish(),
        threadId: z.string().max(128).nullish(),
        topicId: z.string().max(128).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      invokeSandboxTool({
        apiName: input.apiName,
        args: input.arguments,
        db: ctx.serverDB,
        groupId: input.groupId,
        sessionId: input.sessionId,
        threadId: input.threadId,
        topicId: input.topicId,
        userId: ctx.userId,
      }),
    ),
});
