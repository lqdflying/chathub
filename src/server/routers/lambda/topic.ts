import { ChatTopicMetadataSchema } from '@lobechat/types';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { getServerDB } from '@/database/server';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { withConversationWriteLockOrThrow } from '@/server/services/conversationWriteLock';
import { persistMemoryCompactionIfCurrent } from '@/server/services/memoryCompactionPersist';
import { mergeReportedInputTokenFloorWatermark } from '@/server/services/topicReportedInputTokenFloor';
import { BatchTaskResult } from '@/types/service';

const topicProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: { topicModel: new TopicModel(ctx.serverDB, ctx.userId) },
  });
});

export const topicRouter = router({
  batchCreateTopics: topicProcedure
    .input(
      z.union([
        z.array(
          z.object({
            favorite: z.boolean().optional(),
            id: z.string().optional(),
            messages: z.array(z.string()).optional(),
            sessionId: z.string().optional(),
            title: z.string(),
          }),
        ),
        z.object({
          expectedConversationVersion: z.number().optional(),
          topics: z.array(
            z.object({
              favorite: z.boolean().optional(),
              id: z.string().optional(),
              messages: z.array(z.string()).optional(),
              sessionId: z.string().optional(),
              title: z.string(),
            }),
          ),
        }),
      ]),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      const expectedConversationVersion = Array.isArray(input)
        ? undefined
        : input.expectedConversationVersion;
      const topics = Array.isArray(input) ? input : input.topics;
      const data = await withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const topicModel = new TopicModel(transaction, ctx.userId);
          return topicModel.batchCreate(
            topics.map((item) => ({
              ...item,
            })) as any,
          );
        },
        expectedConversationVersion,
      );

      return { added: data.length, ids: [], skips: [], success: true };
    }),

  batchDelete: topicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDelete(input.ids);
    }),

  batchDeleteBySessionId: topicProcedure
    .input(z.object({ id: z.string().nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDeleteBySessionId(input.id);
    }),

  cloneTopic: topicProcedure
    .input(
      z.object({
        expectedConversationVersion: z.number().optional(),
        id: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const topicModel = new TopicModel(transaction, ctx.userId);
          return topicModel.duplicate(input.id, input.newTitle);
        },
        input.expectedConversationVersion,
      );

      return data.topic.id;
    }),

  countTopics: topicProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.topicModel.count(input);
    }),

  createTopic: topicProcedure
    .input(
      z.object({
        clientId: z.string().optional(),
        expectedConversationVersion: z.number().optional(),
        favorite: z.boolean().optional(),
        groupId: z.string().nullable().optional(),
        id: z.string().optional(),
        messages: z.array(z.string()).optional(),
        sessionId: z.string().nullable().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { expectedConversationVersion, ...topic } = input;
      const data = await withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const topicModel = new TopicModel(transaction, ctx.userId);
          return topicModel.create(topic, topic.id);
        },
        expectedConversationVersion,
      );

      return data.id;
    }),

  getAllTopics: topicProcedure.query(async ({ ctx }) => {
    return ctx.topicModel.queryAll();
  }),

  // TODO: this procedure should be used with authedProcedure
  getTopics: publicProcedure
    .input(
      z.object({
        containerId: z.string().nullable().optional(),
        current: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) return [];

      const serverDB = await getServerDB();
      const topicModel = new TopicModel(serverDB, ctx.userId);

      return topicModel.query(input);
    }),

  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),

  listTopicsForAgentMemoryRollup: topicProcedure
    .input(
      z.object({
        agentId: z.string(),
        limit: z.number().min(1).max(500).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.topicModel.listTopicsForAgentMemoryRollup(input.agentId, input.limit);
    }),

  mergeReportedInputTokenFloorWatermark: topicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return withConversationWriteLockOrThrow(ctx.serverDB, ctx.userId, async (transaction) => {
        return mergeReportedInputTokenFloorWatermark({
          messageModel: new MessageModel(transaction, ctx.userId),
          topicId: input.id,
          topicModel: new TopicModel(transaction, ctx.userId),
        });
      });
    }),

  persistMemoryCompaction: topicProcedure
    .input(
      z.object({
        candidateMessageIds: z.array(z.string()),
        compactedThroughMessageId: z.string(),
        expectedCursorId: z.string().optional(),
        expectedFingerprint: z
          .string()
          .length(64)
          .regex(/^[\da-f]{64}$/),
        expectedHistorySummary: z.string(),
        historySummary: z.string(),
        id: z.string(),
        metadata: ChatTopicMetadataSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withConversationWriteLockOrThrow(ctx.serverDB, ctx.userId, async (transaction) => {
        return persistMemoryCompactionIfCurrent({
          candidateMessageIds: input.candidateMessageIds,
          compactedThroughMessageId: input.compactedThroughMessageId,
          expectedCursorId: input.expectedCursorId,
          expectedFingerprint: input.expectedFingerprint,
          expectedHistorySummary: input.expectedHistorySummary,
          historySummary: input.historySummary,
          messageModel: new MessageModel(transaction, ctx.userId),
          metadata: input.metadata,
          topicId: input.id,
          topicModel: new TopicModel(transaction, ctx.userId),
        });
      });
    }),

  rankTopics: topicProcedure.input(z.number().optional()).query(async ({ ctx, input }) => {
    return ctx.topicModel.rank(input);
  }),

  removeAllTopics: topicProcedure.mutation(async ({ ctx }) => {
    return ctx.topicModel.deleteAll();
  }),

  removeTopic: topicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.delete(input.id);
    }),

  searchTopics: topicProcedure
    .input(z.object({ keywords: z.string(), sessionId: z.string().nullable().optional() }))
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.queryByKeyword(input.keywords, input.sessionId);
    }),

  updateTopic: topicProcedure
    .input(
      z.object({
        id: z.string(),
        touchActivity: z.boolean().optional(),
        value: z.object({
          favorite: z.boolean().optional(),
          historySummary: z.string().optional(),
          messages: z.array(z.string()).optional(),
          metadata: ChatTopicMetadataSchema.optional(),
          sessionId: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const replacesCompactionState =
        input.value.historySummary !== undefined || input.value.metadata !== undefined;
      if (!replacesCompactionState) {
        return ctx.topicModel.update(input.id, input.value, {
          touchActivity: input.touchActivity,
        });
      }

      return withConversationWriteLockOrThrow(ctx.serverDB, ctx.userId, async (transaction) => {
        const topicModel = new TopicModel(transaction, ctx.userId);
        return topicModel.update(input.id, input.value, {
          touchActivity: input.touchActivity,
        });
      });
    }),
});

export type TopicRouter = typeof topicRouter;
