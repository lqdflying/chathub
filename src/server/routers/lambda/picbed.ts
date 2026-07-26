import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import { enableAuth } from '@/const/auth';
import { PicbedModel } from '@/database/models/picbed';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';

const picbedProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      picbedModel: new PicbedModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const picbedRouter = router({
  create: picbedProcedure
    .input(
      z.object({
        fileType: z.string(),
        name: z.string(),
        requestedScope: z.string(),
        size: z.number(),
        url: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authenticatedUserId =
        ctx.clerkAuth?.userId ?? ctx.nextAuth?.id ?? ctx.oidcAuth?.sub ?? ctx.userId;
      const isCurrentOwner = enableAuth
        ? input.requestedScope === `user:${authenticatedUserId}`
        : input.requestedScope === 'local';

      if (!isCurrentOwner) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Picbed upload account changed',
        });
      }

      const record = await ctx.picbedModel.create({
        fileType: input.fileType,
        name: input.name,
        size: input.size,
        url: input.url,
      });
      const fullUrl = await ctx.fileService.getFullFileUrl(record.url);
      return { ...record, url: fullUrl };
    }),

  delete: picbedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.picbedModel.delete(input.id);
    }),

  list: picbedProcedure.query(async ({ ctx }) => {
    const records = await ctx.picbedModel.query();
    return Promise.all(
      records.map(async (record) => {
        const fullUrl = await ctx.fileService.getFullFileUrl(record.url);
        return { ...record, url: fullUrl };
      }),
    );
  }),
});
