import { z } from 'zod';

import { passwordProcedure, router } from '@/libs/trpc/edge';
import { S3 } from '@/server/modules/S3';
import { createUploadTarget } from '@/server/services/file/uploadTarget';

export const uploadRouter = router({
  createS3PreSignedUrl: passwordProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        purpose: z.enum(['file', 'ragEval']).default('file'),
      }),
    )
    .mutation(async ({ input }) => {
      const metadata = createUploadTarget(input);
      const s3 = new S3();

      return { metadata, preSignUrl: await s3.createPreSignedUrl(metadata.path) };
    }),
});

export type FileRouter = typeof uploadRouter;
