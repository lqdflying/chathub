import {
  AiCreateAssistantMessageSchema,
  AiSendMessageServerSchema,
  ContextExportRequestContextSchema,
  ConversationGenerationOperation,
  CreateAssistantMessageServerResponse,
  SendMessageServerResponse,
  StructureOutputSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { LOADING_FLAT } from '@/const/message';
import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { idGenerator } from '@/database/utils/idGenerator';
import { pino } from '@/libs/logger';
import { logGenerationDebugSafe } from '@/libs/logger/generationDebug';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { AiChatService } from '@/server/services/aiChat';
import { resolveConversationRuntimePayload } from '@/server/services/conversationGeneration/credentials';
import { isDurableConversationGenerationEnabled } from '@/server/services/conversationGeneration/featureFlag';
import { ConversationGenerationService } from '@/server/services/conversationGeneration/service';
import { findUnsupportedConversationTool } from '@/server/services/conversationGeneration/tools';
import { withConversationWriteLockOrThrow } from '@/server/services/conversationWriteLock';
import { FileService } from '@/server/services/file';
import { contextExportRedactions, sanitizeContextExportValue } from '@/services/chat/contextExport';
import { getXorPayload } from '@/utils/server';

const log = debug('lobe-lambda-router:ai-chat');

const aiChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      aiChatService: new AiChatService(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiChatRouter = router({
  createAssistantMessageInServer: aiChatProcedure
    .input(AiCreateAssistantMessageSchema)
    .mutation(async ({ input, ctx }) => {
      await withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const messageModel = new MessageModel(transaction, ctx.userId);
          const parentMessage = await messageModel.findById(input.parentId);
          const matchesConversation = (message: {
            sessionId?: string | null;
            threadId?: string | null;
            topicId?: string | null;
          }) =>
            (message.sessionId ?? undefined) === input.sessionId &&
            (message.topicId ?? undefined) === input.topicId &&
            (message.threadId ?? undefined) === input.threadId;

          if (
            !parentMessage ||
            parentMessage.role !== 'user' ||
            !matchesConversation(parentMessage)
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'invalid assistant message context',
            });
          }

          const existingMessage = await messageModel.findById(input.assistantMessageId);
          if (existingMessage) {
            const isSamePlaceholder =
              existingMessage.role === 'assistant' &&
              existingMessage.parentId === input.parentId &&
              existingMessage.model === input.model &&
              existingMessage.provider === input.provider &&
              matchesConversation(existingMessage);

            if (!isSamePlaceholder) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'assistant message id is already in use',
              });
            }

            return true;
          }

          await messageModel.create(
            {
              content: LOADING_FLAT,
              fromModel: input.model,
              fromProvider: input.provider,
              parentId: input.parentId,
              role: 'assistant',
              sessionId: input.sessionId!,
              threadId: input.threadId,
              topicId: input.topicId,
            },
            input.assistantMessageId,
          );

          return true;
        },
        input.expectedConversationVersion,
      );

      const { messages } = await ctx.aiChatService.getMessagesAndTopics({
        sessionId: input.sessionId,
        topicId: input.topicId,
      });

      return { messages } as CreateAssistantMessageServerResponse;
    }),

  outputJSON: aiChatProcedure.input(StructureOutputSchema).mutation(async ({ input }) => {
    log('outputJSON called with provider: %s, model: %s', input.provider, input.model);
    log('messages count: %d', input.messages.length);
    log('schema: %O', input.schema);

    let payload: object | undefined;

    try {
      payload = getXorPayload(input.keyVaultsPayload);
      log('payload parsed successfully');
    } catch (e) {
      log('payload parse error: %O', e);
      console.warn('user payload parse error', e);
    }

    if (!payload) {
      log('payload is empty, throwing error');
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'keyVaultsPayload is not correct' });
    }

    log('initializing model runtime with provider: %s', input.provider);
    const modelRuntime = initModelRuntimeWithUserPayload(input.provider, payload);

    log('calling generateObject');
    const result = await modelRuntime.generateObject({
      messages: input.messages,
      model: input.model,
      schema: input.schema,
      tools: input.tools,
    });

    log('generateObject completed, result: %O', result);
    return result;
  }),

  outputJSONWithContext: aiChatProcedure
    .input(
      StructureOutputSchema.extend({
        contextExportRequest: ContextExportRequestContextSchema,
      }),
    )
    .mutation(async ({ input }) => {
      let keyVaults: object | undefined;

      try {
        keyVaults = getXorPayload(input.keyVaultsPayload);
      } catch (error) {
        log('capture-aware payload parse error: %O', error);
      }

      if (!keyVaults) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'keyVaultsPayload is not correct',
        });
      }

      const runtimeProvider =
        (keyVaults as { runtimeProvider?: string }).runtimeProvider ?? input.provider;
      const modelRuntime = initModelRuntimeWithUserPayload(input.provider, keyVaults);
      const generateObjectPayload = {
        messages: input.messages,
        model: input.model,
        schema: input.schema,
        tools: input.tools,
      };
      let preparedProviderRequest:
        | { apiMode?: string; providerRequest: ReturnType<typeof sanitizeContextExportValue> }
        | undefined;

      const createSnapshot = (status: 'complete' | 'error' | 'partial') => ({
        ...input.contextExportRequest,
        engineeredInput: sanitizeContextExportValue(generateObjectPayload),
        metadata: {
          apiMode: preparedProviderRequest?.apiMode ?? 'generateObject',
          model: input.model,
          provider: input.provider,
          runtime: runtimeProvider,
        },
        providerRequest: preparedProviderRequest?.providerRequest,
        redactions: contextExportRedactions,
        status,
      });

      try {
        const result = await modelRuntime.generateObject(generateObjectPayload, {
          onRequestPrepared: (request, metadata) => {
            preparedProviderRequest = {
              apiMode: metadata?.apiMode,
              providerRequest: sanitizeContextExportValue(request),
            };
          },
        });

        return {
          result,
          snapshot: createSnapshot(preparedProviderRequest ? 'complete' : 'partial'),
          success: true as const,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Supervisor provider request failed';

        return {
          error: { message: errorMessage },
          snapshot: {
            ...createSnapshot('error'),
            error: 'Provider request rejected during supervisor generation',
          },
          success: false as const,
        };
      }
    }),

  sendMessageInServer: aiChatProcedure
    .input(AiSendMessageServerSchema)
    .mutation(async ({ input, ctx }) => {
      const start = Date.now();
      log('sendMessageInServer called for sessionId: %s', input.sessionId);
      log('topicId: %s, newTopic: %O', input.topicId, input.newTopic);

      const durableEnabled = await isDurableConversationGenerationEnabled(ctx.userId);
      const requestedDurableGeneration = durableEnabled ? input.generation : undefined;
      let deferReason: SendMessageServerResponse['deferReason'];
      let deferredToolName: string | undefined;
      const unsupportedTool = requestedDurableGeneration
        ? await findUnsupportedConversationTool({
            config: requestedDurableGeneration.config,
            db: ctx.serverDB,
            userId: ctx.userId,
          })
        : undefined;
      if (unsupportedTool) {
        deferReason = 'unsupported_tool';
        deferredToolName = unsupportedTool.identifier;
        logGenerationDebugSafe('enqueue_rejected', {
          kind: 'chat',
          reason: 'unsupported_tool',
          spanId: requestedDurableGeneration?.debugSpanId,
          toolName: unsupportedTool.identifier,
          trpcCode: 'UNPROCESSABLE_CONTENT',
        });
      }
      let durableGeneration = unsupportedTool ? undefined : requestedDurableGeneration;
      if (durableGeneration) {
        try {
          await resolveConversationRuntimePayload({
            db: ctx.serverDB,
            fetchOnClient: durableGeneration.config.fetchOnClient,
            provider: durableGeneration.config.provider,
            userId: ctx.userId,
          });
        } catch (error) {
          if (!(error instanceof TRPCError) || error.code !== 'PRECONDITION_FAILED') throw error;
          deferReason = 'fetch_on_client';
          logGenerationDebugSafe('enqueue_rejected', {
            kind: 'chat',
            reason: 'fetch_on_client',
            spanId: requestedDurableGeneration?.debugSpanId,
            trpcCode: 'PRECONDITION_FAILED',
          });
          durableGeneration = undefined;
        }
      }

      const writeResult = await withConversationWriteLockOrThrow(
        ctx.serverDB,
        ctx.userId,
        async (transaction) => {
          const messageModel = new MessageModel(transaction, ctx.userId);
          const topicModel = new TopicModel(transaction, ctx.userId);
          if (durableGeneration?.idempotencyKey) {
            const existing = await new ConversationGenerationModel(
              transaction,
              ctx.userId,
            ).findByIdempotencyKey(durableGeneration.idempotencyKey);
            if (existing) {
              const matchesRequest =
                existing.kind === 'chat' &&
                (existing.sessionId ?? undefined) === input.sessionId &&
                (existing.threadId ?? undefined) === input.threadId &&
                (!input.topicId || existing.topicId === input.topicId) &&
                existing.config.model === durableGeneration.config.model &&
                existing.config.provider === durableGeneration.config.provider;
              if (!matchesRequest) {
                throw new TRPCError({
                  code: 'CONFLICT',
                  message: 'Generation idempotency key was already used for another request.',
                });
              }
              if (!existing.assistantMessageId || !existing.userMessageId) {
                throw new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'Existing generation operation is missing its persisted messages.',
                });
              }

              return {
                assistantMessageId: existing.assistantMessageId,
                isCreateNewTopic: Boolean(input.newTopic),
                operation: existing,
                operationId: existing.id,
                topicId: existing.topicId ?? input.topicId,
                userMessageId: existing.userMessageId,
              };
            }
          }

          let topicId = input.topicId!;
          let isCreateNewTopic = false;

          if (input.newTopic) {
            log('creating new topic with title: %s', input.newTopic.title);
            const topicItem = await topicModel.create({
              messages: input.newTopic.topicMessageIds,
              sessionId: input.sessionId,
              title: input.newTopic.title,
            });
            topicId = topicItem.id;
            isCreateNewTopic = true;
            log('new topic created with id: %s', topicId);
          }

          const currentTopic =
            durableGeneration && topicId && !isCreateNewTopic
              ? await topicModel.findById(topicId)
              : undefined;
          const shouldGenerateTitle =
            Boolean(durableGeneration && topicId && !durableGeneration.config.isWelcomeQuestion) &&
            (isCreateNewTopic || !currentTopic?.title?.trim());
          const titleConfig = shouldGenerateTitle
            ? { force: isCreateNewTopic, topicId }
            : undefined;

          log('creating user message with content length: %d', input.newUserMessage.content.length);
          const userMessageItem = await messageModel.create({
            content: input.newUserMessage.content,
            files: input.newUserMessage.files,
            metadata: input.newUserMessage.metadata,
            role: 'user',
            sessionId: input.sessionId!,
            threadId: input.threadId,
            topicId,
          });

          log('user message created with id: %s', userMessageItem.id);

          const assistantMessageId = idGenerator('messages', 14);
          log('reserved assistant message id: %s', assistantMessageId);

          let generationOperation: ConversationGenerationOperation | undefined;
          let operationId: string | undefined;
          if (durableGeneration) {
            await messageModel.create(
              {
                content: LOADING_FLAT,
                fromModel: durableGeneration.config.model,
                fromProvider: durableGeneration.config.provider,
                parentId: userMessageItem.id,
                role: 'assistant',
                sessionId: input.sessionId!,
                threadId: input.threadId,
                topicId,
              },
              assistantMessageId,
            );
            const generationService = new ConversationGenerationService(ctx.serverDB, ctx.userId);
            const operation = await generationService.enqueueInTransaction(transaction, {
              assistantMessageId,
              config: {
                ...durableGeneration.config,
                title: titleConfig,
              },
              conversationVersion: input.expectedConversationVersion,
              debugSpanId: durableGeneration.debugSpanId,
              expectedConversationVersion: input.expectedConversationVersion,
              idempotencyKey: durableGeneration.idempotencyKey,
              kind: 'chat',
              parentMessageId: userMessageItem.id,
              replaceActive: true,
              sessionId: input.sessionId,
              threadId: input.threadId,
              topicId,
              userMessageId: userMessageItem.id,
            });
            generationOperation = operation;
            operationId = operation.id;
          }

          return {
            assistantMessageId,
            isCreateNewTopic,
            operation: generationOperation,
            operationId,
            topicId,
            userMessageId: userMessageItem.id,
          };
        },
        input.expectedConversationVersion,
      );

      // retrieve latest messages and topic with
      log('retrieving messages and topics');
      const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
        includeTopic: true,
        sessionId: input.sessionId,
        topicId: writeResult.topicId,
      });

      log('retrieved %d messages, %d topics', messages.length, topics?.length ?? 0);
      pino.debug(
        `sendMessageInServer completed in ${Date.now() - start}ms (sessionId=${input.sessionId})`,
      );

      return {
        assistantMessageId: writeResult.assistantMessageId,
        deferReason,
        deferredToolName,
        isCreateNewTopic: writeResult.isCreateNewTopic,
        messages,
        operation: writeResult.operation,
        operationId: writeResult.operationId,
        topicId: writeResult.topicId,
        topics,
        userMessageId: writeResult.userMessageId,
      } as SendMessageServerResponse;
    }),
});
