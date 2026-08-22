import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { runCodeInterpreter } from '@/server/services/codeInterpreter';

const codeInterpreterProcedure = authedProcedure.use(serverDatabase);

export const codeInterpreterRouter = router({
  run: codeInterpreterProcedure
    .input(
      z.object({
        code: z.string().min(1).max(512_000),
        groupId: z.string().max(128).nullish(),
        packages: z.array(z.string().max(256)).max(50).optional(),
        sessionId: z.string().max(128).nullish(),
        threadId: z.string().max(128).nullish(),
        topicId: z.string().max(128).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runCodeInterpreter({
        code: input.code,
        db: ctx.serverDB,
        groupId: input.groupId,
        packages: input.packages,
        sessionId: input.sessionId,
        threadId: input.threadId,
        topicId: input.topicId,
        userId: ctx.userId,
      });
    }),
});
