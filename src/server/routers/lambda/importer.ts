import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { DataImporterRepos } from '@/database/repositories/dataImporter';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { withConversationWriteLockOrThrow } from '@/server/services/conversationWriteLock';
import { FileService } from '@/server/services/file';
import { ImportPgDataStructure } from '@/types/export';
import { ImportResultData, ImporterEntryData } from '@/types/importer';

const importProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

export const importerRouter = router({
  importByFile: importProcedure
    .input(
      z.object({
        expectedConversationVersion: z.number().optional(),
        pathname: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      let data: ImporterEntryData | undefined;

      try {
        const dataStr = await ctx.fileService.getFileContent(input.pathname);
        data = JSON.parse(dataStr);
      } catch {
        data = undefined;
      }

      if (!data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to read file at ${input.pathname}`,
        });
      }

      let result: ImportResultData;
      if ('schemaHash' in data) {
        result = await withConversationWriteLockOrThrow(
          ctx.serverDB,
          ctx.userId,
          async (transaction) => {
            const dataImporterService = new DataImporterRepos(transaction, ctx.userId);
            return dataImporterService.importPgData(data as unknown as ImportPgDataStructure);
          },
          input.expectedConversationVersion,
        );
      } else {
        result = await withConversationWriteLockOrThrow(
          ctx.serverDB,
          ctx.userId,
          async (transaction) => {
            const dataImporterService = new DataImporterRepos(transaction, ctx.userId);
            return dataImporterService.importData(data);
          },
          input.expectedConversationVersion,
        );
      }

      // clean file after upload
      await ctx.fileService.deleteFile(input.pathname);

      return result;
    }),

  importByPost: importProcedure
    .input(
      z.object({
        data: z.object({
          messages: z.array(z.any()).optional(),
          sessionGroups: z.array(z.any()).optional(),
          sessions: z.array(z.any()).optional(),
          topics: z.array(z.any()).optional(),
          version: z.number(),
        }),
        expectedConversationVersion: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      return withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const dataImporterService = new DataImporterRepos(transaction, ctx.userId);
          return dataImporterService.importData(input.data);
        },
        input.expectedConversationVersion,
      );
    }),
  importPgByPost: importProcedure
    .input(
      z.object({
        data: z.record(z.string(), z.array(z.any())),
        expectedConversationVersion: z.number().optional(),
        mode: z.enum(['pglite', 'postgres']),
        schemaHash: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      const { expectedConversationVersion, ...importData } = input;

      return withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const dataImporterService = new DataImporterRepos(transaction, ctx.userId);
          return dataImporterService.importPgData(importData);
        },
        expectedConversationVersion,
      );
    }),
});
