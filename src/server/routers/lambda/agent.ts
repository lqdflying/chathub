import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import { KnowledgeItem, KnowledgeType } from '@lobechat/types';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { pino } from '@/libs/logger';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';
import { executeAssistantMemoryDream } from '@/server/services/assistantMemoryDream';
import {
  applyDreamMemoryRetentionOnServer,
  clearDreamMemoryOnServer,
  deleteDreamMemoryCardOnServer,
  updateDreamMemoryCardOnServer,
} from '@/server/services/assistantMemoryDream/mutateDocument';

const agentProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId),
      agentService: new AgentService(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const agentRouter = router({
  applyDreamMemoryRetention: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        maxEntries: z.number().int().min(1).max(90),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return applyDreamMemoryRetentionOnServer({
        agentId: input.agentId,
        db: ctx.serverDB,
        maxEntries: input.maxEntries,
        userId: ctx.userId!,
      });
    }),

  clearDreamMemory: agentProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return clearDreamMemoryOnServer({
        agentId: input.agentId,
        db: ctx.serverDB,
        userId: ctx.userId!,
      });
    }),

  createAgentFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.createAgentFiles(input.agentId, input.fileIds, input.enabled);
    }),

  createAgentKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.createAgentKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  deleteAgentFile: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.deleteAgentFile(input.agentId, input.fileId);
    }),

  deleteAgentKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.deleteAgentKnowledgeBase(input.agentId, input.knowledgeBaseId);
    }),

  deleteDreamMemoryCard: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        dateTag: z.string().min(1),
        index: z.number().int().min(1),
        match: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return deleteDreamMemoryCardOnServer({
        agentId: input.agentId,
        dateTag: input.dateTag,
        db: ctx.serverDB,
        index: input.index,
        match: input.match,
        userId: ctx.userId!,
      });
    }),

  getAgentConfig: agentProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.sessionId === INBOX_SESSION_ID) {
        const item = await ctx.sessionModel.findByIdOrSlug(INBOX_SESSION_ID);
        // if there is no session for user, create one
        if (!item) {
          // if there is no user, return default config
          const user = await UserModel.findById(ctx.serverDB, ctx.userId);
          if (!user) return DEFAULT_AGENT_CONFIG;

          const res = await ctx.agentService.createInbox();
          pino.info({ res }, 'create inbox session');
        }
      }

      const session = await ctx.sessionModel.findByIdOrSlug(input.sessionId);

      if (!session) throw new Error('Session not found');
      const sessionId = session.id;

      return ctx.agentModel.findBySessionId(sessionId);
    }),

  getKnowledgeBasesAndFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItem[]> => {
      const knowledgeBases = await ctx.knowledgeBaseModel.query();

      const files = await ctx.fileModel.query({
        showFilesInKnowledgeBase: false,
      });

      const knowledge = await ctx.agentModel.getAgentAssignedKnowledge(input.agentId);

      return [
        ...files
          // 过滤掉所有图片
          .filter((file) => !file.fileType.startsWith('image'))
          .map((file) => ({
            enabled: knowledge.files.some((item) => item.id === file.id),
            fileType: file.fileType,
            id: file.id,
            name: file.name,
            type: KnowledgeType.File,
          })),
        ...knowledgeBases.map((knowledgeBase) => ({
          avatar: knowledgeBase.avatar,
          description: knowledgeBase.description,
          enabled: knowledge.knowledgeBases.some((item) => item.id === knowledgeBase.id),
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          type: KnowledgeType.KnowledgeBase,
        })),
      ];
    }),

  regenerateDreamMemory: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        historyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        index: z.number().int().min(1),
        match: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return executeAssistantMemoryDream({
        agentId: input.agentId,
        db: ctx.serverDB,
        historyDate: input.historyDate,
        match: input.match,
        mode: 'regenerate',
        replaceIndex: input.index,
        userId: ctx.userId!,
      });
    }),

  toggleFile: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.toggleFile(input.agentId, input.fileId, input.enabled);
    }),

  toggleKnowledgeBase: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.toggleKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  updateDreamMemoryCard: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        body: z.string().min(1),
        dateTag: z.string().min(1),
        index: z.number().int().min(1),
        match: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return updateDreamMemoryCardOnServer({
        agentId: input.agentId,
        body: input.body,
        dateTag: input.dateTag,
        db: ctx.serverDB,
        index: input.index,
        match: input.match,
        userId: ctx.userId!,
      });
    }),
});
