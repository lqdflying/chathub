import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { S3 } from '@/server/modules/S3';
import { isValidUploadPathname } from '@/server/services/file/fileReference';

export const uploadRouter = router({
  createS3PreSignedUrl: authedProcedure
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input }) => {
      // Never sign a PUT for a privileged namespace (generation assets, avatars) or a
      // traversal-shaped key — otherwise any authenticated user could write to another
      // user's or the system's objects.
      if (!isValidUploadPathname(input.pathname)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalid upload pathname' });
      }

      const s3 = new S3();

      return await s3.createPreSignedUrl(input.pathname);
    }),
});

export type FileRouter = typeof uploadRouter;
