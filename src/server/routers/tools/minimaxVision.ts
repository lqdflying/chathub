import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { minimaxVisionService } from '@/server/services/minimaxVision';

export const minimaxVisionRouter = router({
  analyze: authedProcedure
    .input(
      z.object({
        imageUrl: z.string(),
        prompt: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return minimaxVisionService.analyzeImage(input.imageUrl, input.prompt);
    }),
});
