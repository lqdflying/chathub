import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { S3 } from '@/server/modules/S3';
import { createUploadTarget } from '@/server/services/file/uploadTarget';

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        purpose: z.enum(['file', 'ragEval']).default('file'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const metadata = createUploadTarget({ ...input, userId: ctx.userId });
      const s3 = new S3();

      return { metadata, preSignUrl: await s3.createPreSignedUrl(metadata.path) };
    }),
});

export type FileRouter = typeof uploadRouter;
