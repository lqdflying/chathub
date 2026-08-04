import {
  ChatFileItem,
  ChatImageItem,
  ChatTTS,
  ChatToolPayload,
  ChatTranslate,
  ChatVideoItem,
  CreateMessageParams,
  CreateMessageResult,
  DBMessageItem,
  ModelRankItem,
  NewMessageQueryParams,
  QueryMessageParams,
  UIChatMessage,
  UpdateMessageParams,
  UpdateMessageRAGParams,
} from '@lobechat/types';
import type { HeatmapsProps } from '@lobehub/charts';
import dayjs from 'dayjs';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, like, sql } from 'drizzle-orm';

import { merge } from '@/utils/merge';
import { today } from '@/utils/time';

import {
  MessagePluginItem,
  chunks,
  documents,
  embeddings,
  fileChunks,
  files,
  messagePlugins,
  messageGroups,
  messageQueries,
  messageQueryChunks,
  messageTTS,
  messageTranslates,
  messages,
  messagesFiles,
  threads,
  topics,
} from '../schemas';
import { LobeChatDatabase, Transaction } from '../type';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';
import {
  removeMessageOrder,
  sortMessagesParentFirst,
} from '../utils/sortMessagesParentFirst';

type MessageWithInternalOrder = DBMessageItem & { messageOrder?: bigint };

const MCP_RESULT_RECOVERY_STATE_KEY = 'chathubMcpResultRecovery';

interface MCPResultRecoveryState {
  invocationId: string;
  status: 'pending' | 'persisted';
}

export class MessageModel {
  private userId: string;
  private db: LobeChatDatabase | Transaction;

  constructor(db: LobeChatDatabase | Transaction, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // **************** Query *************** //
  query = async (
    { current = 0, pageSize = 1000, sessionId, topicId, groupId }: QueryMessageParams = {},
    options: {
      postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>;
    } = {},
  ) => {
    const offset = current * pageSize;

    // 1. get basic messages
    const result = await this.db
      .select({
        /* eslint-disable sort-keys-fix/sort-keys-fix*/
        id: messages.id,
        role: messages.role,
        content: messages.content,
        reasoning: messages.reasoning,
        search: messages.search,
        metadata: messages.metadata,
        error: messages.error,

        model: messages.model,
        provider: messages.provider,

        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,

        topicId: messages.topicId,
        parentId: messages.parentId,
        threadId: messages.threadId,

        // Group chat fields
        groupId: messages.groupId,
        agentId: messages.agentId,
        targetId: messages.targetId,

        tools: messages.tools,
        tool_call_id: messagePlugins.toolCallId,

        plugin: {
          apiName: messagePlugins.apiName,
          arguments: messagePlugins.arguments,
          identifier: messagePlugins.identifier,
          type: messagePlugins.type,
        },
        pluginError: messagePlugins.error,
        pluginState: messagePlugins.state,

        translate: {
          content: messageTranslates.content,
          from: messageTranslates.from,
          to: messageTranslates.to,
        },

        ttsId: messageTTS.id,
        ttsContentMd5: messageTTS.contentMd5,
        ttsFile: messageTTS.fileId,
        ttsVoice: messageTTS.voice,
        /* eslint-enable */
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, this.userId),
          this.matchSession(sessionId),
          this.matchTopic(topicId),
          this.matchGroup(groupId),
        ),
      )
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .leftJoin(messageTranslates, eq(messageTranslates.id, messages.id))
      .leftJoin(messageTTS, eq(messageTTS.id, messages.id))
      .orderBy(asc(messages.createdAt), asc(messages.messageOrder))
      .limit(pageSize)
      .offset(offset);

    const messageIds = result.map((message) => message.id as string);

    if (messageIds.length === 0) return [];

    // 2. get relative files
    const rawRelatedFileList = await this.db
      .select({
        fileType: files.fileType,
        id: messagesFiles.fileId,
        messageId: messagesFiles.messageId,
        name: files.name,
        size: files.size,
        url: files.url,
      })
      .from(messagesFiles)
      .leftJoin(files, eq(files.id, messagesFiles.fileId))
      .where(inArray(messagesFiles.messageId, messageIds));

    const relatedFileList = await Promise.all(
      rawRelatedFileList.map(async (file) => ({
        ...file,
        url: options.postProcessUrl
          ? await options.postProcessUrl(file.url, file as any)
          : (file.url as string),
      })),
    );

    // 获取关联的文档内容
    const fileIds = relatedFileList.map((file) => file.id).filter(Boolean);

    let documentsMap: Record<string, string> = {};

    if (fileIds.length > 0) {
      const documentsList = await this.db
        .select({
          content: documents.content,
          fileId: documents.fileId,
        })
        .from(documents)
        .where(inArray(documents.fileId, fileIds));

      documentsMap = documentsList.reduce(
        (acc, doc) => {
          if (doc.fileId) acc[doc.fileId] = doc.content as string;
          return acc;
        },
        {} as Record<string, string>,
      );
    }

    const imageList = relatedFileList.filter((i) => (i.fileType || '').startsWith('image'));
    const videoList = relatedFileList.filter((i) => (i.fileType || '').startsWith('video'));
    const fileList = relatedFileList.filter(
      (i) => !(i.fileType || '').startsWith('image') && !(i.fileType || '').startsWith('video'),
    );

    // 3. get relative file chunks
    const chunksList = await this.db
      .select({
        fileId: files.id,
        fileType: files.fileType,
        fileUrl: files.url,
        filename: files.name,
        id: chunks.id,
        messageId: messageQueryChunks.messageId,
        similarity: messageQueryChunks.similarity,
        text: chunks.text,
      })
      .from(messageQueryChunks)
      .leftJoin(chunks, eq(chunks.id, messageQueryChunks.chunkId))
      .leftJoin(fileChunks, eq(fileChunks.chunkId, chunks.id))
      .innerJoin(files, eq(fileChunks.fileId, files.id))
      .where(inArray(messageQueryChunks.messageId, messageIds));

    // 3. get relative message query
    const messageQueriesList = await this.db
      .select({
        id: messageQueries.id,
        messageId: messageQueries.messageId,
        rewriteQuery: messageQueries.rewriteQuery,
        userQuery: messageQueries.userQuery,
      })
      .from(messageQueries)
      .where(inArray(messageQueries.messageId, messageIds));

    return result.map(
      ({ model, provider, translate, ttsId, ttsFile, ttsContentMd5, ttsVoice, ...item }) => {
        const messageQuery = messageQueriesList.find((relation) => relation.messageId === item.id);
        return {
          ...item,
          chunksList: chunksList
            .filter((relation) => relation.messageId === item.id)
            .map((c) => ({
              ...c,
              similarity: Number(c.similarity) ?? undefined,
            })),

          extra: {
            fromModel: model,
            fromProvider: provider,
            translate,
            tts: ttsId
              ? {
                  contentMd5: ttsContentMd5,
                  file: ttsFile,
                  voice: ttsVoice,
                }
              : undefined,
          },
          fileList: fileList
            .filter((relation) => relation.messageId === item.id)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map<ChatFileItem>(({ id, url, size, fileType, name }) => ({
              content: documentsMap[id],
              fileType: fileType!,
              id,
              name: name!,
              size: size!,
              url,
            })),

          imageList: imageList
            .filter((relation) => relation.messageId === item.id)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map<ChatImageItem>(({ id, url, name }) => ({ alt: name!, id, url })),

          meta: {},
          ragQuery: messageQuery?.rewriteQuery,
          ragQueryId: messageQuery?.id,
          ragRawQuery: messageQuery?.userQuery,
          videoList: videoList
            .filter((relation) => relation.messageId === item.id)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map<ChatVideoItem>(({ id, url, name }) => ({ alt: name!, id, url })),
        } as unknown as UIChatMessage;
      },
    );
  };

  findById = async (id: string) => {
    const message = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), eq(messages.userId, this.userId)),
    });

    return message ? removeMessageOrder(message) : undefined;
  };

  findMessageQueriesById = async (messageId: string) => {
    const result = await this.db
      .select({
        embeddingModel: embeddings.model,
        embeddings: embeddings.embeddings,
        embeddingsId: messageQueries.embeddingsId,
        id: messageQueries.id,
        query: messageQueries.rewriteQuery,
        rewriteQuery: messageQueries.rewriteQuery,
        userQuery: messageQueries.userQuery,
      })
      .from(messageQueries)
      .where(
        and(eq(messageQueries.messageId, messageId), eq(messageQueries.userId, this.userId)),
      )
      .leftJoin(
        embeddings,
        and(eq(embeddings.id, messageQueries.embeddingsId), eq(embeddings.userId, this.userId)),
      );

    if (result.length === 0) return undefined;

    return result[0];
  };

  queryAll = async () => {
    const result = await this.db
      .select()
      .from(messages)
      .orderBy(asc(messages.createdAt), asc(messages.messageOrder))
      .where(eq(messages.userId, this.userId));

    return result.map(removeMessageOrder) as DBMessageItem[];
  };

  queryBySessionId = async (sessionId?: string | null) => {
    const result = await this.db.query.messages.findMany({
      orderBy: [asc(messages.createdAt), asc(messages.messageOrder)],
      where: and(eq(messages.userId, this.userId), this.matchSession(sessionId)),
    });

    return result.map(removeMessageOrder) as DBMessageItem[];
  };

  queryByKeyword = async (keyword: string) => {
    if (!keyword) return [];
    const result = await this.db.query.messages.findMany({
      orderBy: [desc(messages.createdAt), desc(messages.messageOrder)],
      where: and(eq(messages.userId, this.userId), like(messages.content, `%${keyword}%`)),
    });

    return result.map(removeMessageOrder) as DBMessageItem[];
  };

  count = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: count(messages.id),
      })
      .from(messages)
      .where(
        genWhere([
          eq(messages.userId, this.userId),
          params?.range
            ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return result[0].count;
  };

  countWords = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: sql<string>`sum(length(${messages.content}))`.as('total_length'),
      })
      .from(messages)
      .where(
        genWhere([
          eq(messages.userId, this.userId),
          params?.range
            ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return Number(result[0].count);
  };

  rankModels = async (limit: number = 10): Promise<ModelRankItem[]> => {
    return this.db
      .select({
        count: count(messages.id).as('count'),
        id: messages.model,
      })
      .from(messages)
      .where(and(eq(messages.userId, this.userId), isNotNull(messages.model)))
      .having(({ count }) => gt(count, 0))
      .groupBy(messages.model)
      .orderBy(desc(sql`count`), asc(messages.model))
      .limit(limit);
  };

  getHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    const startDate = today().subtract(1, 'year').startOf('day');
    const endDate = today().endOf('day');

    const result = await this.db
      .select({
        count: count(messages.id),
        date: sql`DATE(${messages.createdAt})`.as('heatmaps_date'),
      })
      .from(messages)
      .where(
        genWhere([
          eq(messages.userId, this.userId),
          genRangeWhere(
            [startDate.format('YYYY-MM-DD'), endDate.add(1, 'day').format('YYYY-MM-DD')],
            messages.createdAt,
            (date) => date.toDate(),
          ),
        ]),
      )
      .groupBy(sql`heatmaps_date`)
      .orderBy(desc(sql`heatmaps_date`));

    const heatmapData: HeatmapsProps['data'] = [];
    let currentDate = startDate.clone();

    const dateCountMap = new Map<string, number>();
    for (const item of result) {
      if (item?.date) {
        const dateStr = dayjs(item.date as string).format('YYYY-MM-DD');
        dateCountMap.set(dateStr, Number(item.count) || 0);
      }
    }

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const formattedDate = currentDate.format('YYYY-MM-DD');
      const count = dateCountMap.get(formattedDate) || 0;

      const levelCount = count > 0 ? Math.ceil(count / 5) : 0;
      const level = levelCount > 4 ? 4 : levelCount;

      heatmapData.push({
        count,
        date: formattedDate,
        level,
      });

      currentDate = currentDate.add(1, 'day');
    }

    return heatmapData;
  };

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.userId, this.userId))
      .limit(n + 1);

    return result.length > n;
  };

  // **************** Create *************** //

  create = async (
    params: CreateMessageParams,
    id: string = this.genId(),
  ): Promise<DBMessageItem> => {
    const {
      fromModel,
      fromProvider,
      files,
      plugin,
      pluginState,
      fileChunks,
      ragQueryId,
      updatedAt,
      createdAt,
      ...message
    } = removeMessageOrder(params);

    return this.db.transaction(async (trx) => {
      // Ensure group message does not populate sessionId
      const normalizedMessage = message.groupId ? { ...message, sessionId: null } : message;

      const [item] = (await trx
        .insert(messages)
        .values({
          ...normalizedMessage,
          // TODO: remove this when the client is updated
          createdAt: createdAt ? new Date(createdAt) : undefined,
          id,
          model: fromModel,
          provider: fromProvider,
          updatedAt: updatedAt ? new Date(updatedAt) : undefined,
          userId: this.userId,
        })
        .returning()) as MessageWithInternalOrder[];

      // Insert the plugin data if the message is a tool
      if (message.role === 'tool') {
        await trx.insert(messagePlugins).values({
          apiName: plugin?.apiName,
          arguments: plugin?.arguments,
          id,
          identifier: plugin?.identifier,
          state: pluginState,
          toolCallId: message.tool_call_id,
          type: plugin?.type,
          userId: this.userId,
        });
      }

      if (files && files.length > 0) {
        await trx
          .insert(messagesFiles)
          .values(files.map((file) => ({ fileId: file, messageId: id, userId: this.userId })));
      }

      if (fileChunks && fileChunks.length > 0 && ragQueryId) {
        await trx.insert(messageQueryChunks).values(
          fileChunks.map((chunk) => ({
            chunkId: chunk.id,
            messageId: id,
            queryId: ragQueryId,
            similarity: chunk.similarity?.toString(),
            userId: this.userId,
          })),
        );
      }

      if (message.topicId) {
        await trx
          .update(topics)
          .set({ lastActivityAt: new Date() })
          .where(and(eq(topics.id, message.topicId), eq(topics.userId, this.userId)));
      }

      return removeMessageOrder(item) as DBMessageItem;
    });
  };

  /**
   * Create a new message and return the complete message list
   *
   * This method combines message creation and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   *
   * @param params - Message creation parameters
   * @param options - Query options for post-processing
   * @returns Object containing the created message ID and full message list
   *
   * @example
   * const { id, messages } = await messageModel.createNewMessage({
   *   role: 'assistant',
   *   content: 'Hello',
   *   tools: [...],
   *   sessionId: 'session-1',
   * });
   * // messages already contains grouped structure, no need to refresh
   */
  createNewMessage = async (
    params: CreateMessageParams,
    options: {
      postProcessUrl?: (path: string | null, file: { fileType: string }) => Promise<string>;
    } = {},
  ): Promise<CreateMessageResult> => {
    // 1. Create the message (reuse existing create method)
    const item = await this.create(params);

    // 2. Query all messages for this session/topic
    // query() method internally applies groupAssistantMessages transformation
    const messages = await this.query(
      {
        current: 0,
        groupId: params.groupId,
        pageSize: 9999,
        sessionId: params.sessionId,
        topicId: params.topicId, // Get all messages
      },
      options,
    );

    // 3. Return the result
    return {
      id: item.id,
      messages,
    };
  };

  batchCreate = async (newMessages: DBMessageItem[]) => {
    const messagesToInsert = sortMessagesParentFirst(newMessages).map((message) => {
      const publicMessage = removeMessageOrder(message as MessageWithInternalOrder);
      // TODO: need a better way to handle this
      return {
        ...publicMessage,
        role: publicMessage.role as any,
        userId: this.userId,
      };
    });

    return this.db.insert(messages).values(messagesToInsert);
  };

  createMessageQuery = async (params: NewMessageQueryParams) => {
    const result = await this.db
      .insert(messageQueries)
      .values({ ...params, userId: this.userId })
      .returning();

    return result[0];
  };

  replaceMessageQuery = async (params: NewMessageQueryParams) => {
    return this.db.transaction(async (trx) => {
      const current = await trx.query.messageQueries.findFirst({
        where: and(
          eq(messageQueries.messageId, params.messageId),
          eq(messageQueries.userId, this.userId),
        ),
      });

      if (!current) {
        const [created] = await trx
          .insert(messageQueries)
          .values({ ...params, userId: this.userId })
          .returning();
        return created;
      }

      const [updated] = await trx
        .update(messageQueries)
        .set({
          embeddingsId: params.embeddingsId,
          rewriteQuery: params.rewriteQuery,
          userQuery: params.userQuery,
        })
        .where(and(eq(messageQueries.id, current.id), eq(messageQueries.userId, this.userId)))
        .returning();

      if (current.embeddingsId && current.embeddingsId !== params.embeddingsId) {
        await trx
          .delete(embeddings)
          .where(
            and(eq(embeddings.id, current.embeddingsId), eq(embeddings.userId, this.userId)),
          );
      }

      return updated;
    });
  };
  // **************** Update *************** //

  update = async (id: string, params: Partial<UpdateMessageParams>) => {
    const { imageList, ...message } = removeMessageOrder(params);

    return this.db.transaction(async (trx) => {
      // 1. insert message files
      if (imageList && imageList.length > 0) {
        await trx
          .insert(messagesFiles)
          .values(
            imageList.map((file) => ({ fileId: file.id, messageId: id, userId: this.userId })),
          )
          .onConflictDoNothing();
      }

      return trx
        .update(messages)
        .set({
          ...message,
          // TODO: need a better way to handle this
          // TODO: but I forget why 🤡
          role: message.role as any,
        })
        .where(and(eq(messages.id, id), eq(messages.userId, this.userId)));
    });
  };

  beginMCPResultInvocation = async (id: string, invocationId: string): Promise<boolean> => {
    const recoveryState: MCPResultRecoveryState = {
      invocationId,
      status: 'pending',
    };
    const result = await this.db
      .update(messagePlugins)
      .set({
        state: sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || jsonb_build_object(${MCP_RESULT_RECOVERY_STATE_KEY}::text, ${JSON.stringify(recoveryState)}::jsonb)`,
      })
      .where(and(eq(messagePlugins.id, id), eq(messagePlugins.userId, this.userId)))
      .returning({ id: messagePlugins.id });

    return result.length === 1;
  };

  persistMCPResult = async (
    id: string,
    invocationId: string,
    content: string,
  ): Promise<boolean> => {
    return this.db.transaction(async (trx) => {
      const persistedRecoveryState: MCPResultRecoveryState = {
        invocationId,
        status: 'persisted',
      };
      const pluginResult = await trx
        .update(messagePlugins)
        .set({
          state: sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || jsonb_build_object(${MCP_RESULT_RECOVERY_STATE_KEY}::text, ${JSON.stringify(persistedRecoveryState)}::jsonb)`,
        })
        .where(
          and(
            eq(messagePlugins.id, id),
            eq(messagePlugins.userId, this.userId),
            sql`${messagePlugins.state} -> ${MCP_RESULT_RECOVERY_STATE_KEY}::text ->> 'invocationId' = ${invocationId}`,
            sql`${messagePlugins.state} -> ${MCP_RESULT_RECOVERY_STATE_KEY}::text ->> 'status' = 'pending'`,
          ),
        )
        .returning({ id: messagePlugins.id });
      if (pluginResult.length !== 1) return false;

      const messageResult = await trx
        .update(messages)
        .set({ content })
        .where(and(eq(messages.id, id), eq(messages.userId, this.userId)))
        .returning({ id: messages.id });
      if (messageResult.length !== 1) {
        throw new Error('MCP tool message disappeared during result persistence.');
      }

      return true;
    });
  };

  recoverMCPResult = async (
    id: string,
    invocationId: string,
  ): Promise<{ content: string } | undefined> => {
    const result = await this.db
      .select({
        content: messages.content,
        state: messagePlugins.state,
      })
      .from(messages)
      .innerJoin(
        messagePlugins,
        and(eq(messagePlugins.id, messages.id), eq(messagePlugins.userId, this.userId)),
      )
      .where(and(eq(messages.id, id), eq(messages.userId, this.userId)))
      .limit(1);
    const item = result[0];
    const recoveryState = (item?.state as Record<string, unknown> | null)?.[
      MCP_RESULT_RECOVERY_STATE_KEY
    ] as MCPResultRecoveryState | undefined;

    if (
      recoveryState?.invocationId !== invocationId ||
      recoveryState.status !== 'persisted' ||
      typeof item?.content !== 'string'
    ) {
      return undefined;
    }

    return { content: item.content };
  };

  updateMetadata = async (id: string, metadata: Record<string, any>) => {
    const item = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), eq(messages.userId, this.userId)),
    });

    if (!item) return;

    return this.db
      .update(messages)
      .set({ metadata: merge(item.metadata || {}, metadata) })
      .where(and(eq(messages.userId, this.userId), eq(messages.id, id)));
  };

  updatePluginState = async (id: string, state: Record<string, any>) => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, id),
    });
    if (!item) throw new Error('Plugin not found');

    return this.db
      .update(messagePlugins)
      .set({ state: merge(item.state || {}, state) })
      .where(eq(messagePlugins.id, id));
  };

  updateMessagePlugin = async (id: string, value: Partial<MessagePluginItem>) => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: eq(messagePlugins.id, id),
    });
    if (!item) throw new Error('Plugin not found');

    return this.db.update(messagePlugins).set(value).where(eq(messagePlugins.id, id));
  };

  updateTranslate = async (id: string, translate: Partial<ChatTranslate>) => {
    const result = await this.db.query.messageTranslates.findFirst({
      where: and(eq(messageTranslates.id, id)),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTranslates).values({ ...translate, id, userId: this.userId });
    }

    // or just update the existing one
    return this.db.update(messageTranslates).set(translate).where(eq(messageTranslates.id, id));
  };

  updateTTS = async (id: string, tts: Partial<ChatTTS>) => {
    const result = await this.db.query.messageTTS.findFirst({
      where: and(eq(messageTTS.id, id)),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTTS).values({
        contentMd5: tts.contentMd5,
        fileId: tts.file,
        id,
        userId: this.userId,
        voice: tts.voice,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTTS)
      .set({ contentMd5: tts.contentMd5, fileId: tts.file, voice: tts.voice })
      .where(eq(messageTTS.id, id));
  };

  async updateMessageRAG(id: string, { ragQueryId, fileChunks }: UpdateMessageRAGParams) {
    return this.db.insert(messageQueryChunks).values(
      fileChunks.map((chunk) => ({
        chunkId: chunk.id,
        messageId: id,
        queryId: ragQueryId,
        similarity: chunk.similarity?.toString(),
        userId: this.userId,
      })),
    );
  }

  // **************** Delete *************** //

  deleteMessage = async (id: string) => {
    return this.db.transaction(async (tx) => {
      // 1. 查询要删除的 message 的完整信息
      const message = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, id), eq(messages.userId, this.userId)))
        .limit(1);

      // 如果找不到要删除的 message,直接返回
      if (message.length === 0) return;

      // 2. 检查 message 是否包含 tools
      const toolCallIds = (message[0].tools as ChatToolPayload[])
        ?.map((tool) => tool.id)
        .filter(Boolean);

      let relatedMessageIds: string[] = [];

      if (toolCallIds?.length > 0) {
        // 3. 如果 message 包含 tools,查询出所有相关联的 message id
        const res = await tx
          .select({ id: messagePlugins.id })
          .from(messagePlugins)
          .where(inArray(messagePlugins.toolCallId, toolCallIds));

        relatedMessageIds = res.map((row) => row.id);
      }

      // 4. 合并要删除的 message id 列表
      const messageIdsToDelete = [id, ...relatedMessageIds];

      // 5. 删除所有相关的 message
      await tx.delete(messages).where(inArray(messages.id, messageIdsToDelete));
    });
  };

  deleteMessages = async (ids: string[]) =>
    this.db
      .delete(messages)
      .where(and(eq(messages.userId, this.userId), inArray(messages.id, ids)));

  /**
   * Delete a conversation tail and every thread that depends on a message in that tail.
   *
   * `threads.sourceMessageId` intentionally has no foreign key, so a plain message delete can
   * leave orphaned threads behind. Keep discovery and deletion in one transaction and return the
   * complete deleted set so clients can reconcile optimistic state.
   */
  rewindMessages = async (ids: string[]) => {
    if (ids.length === 0) return { messageIds: [], threadIds: [] };

    return this.db.transaction(async (tx) => {
      const requestedMessages = await tx
        .select({ id: messages.id, topicId: messages.topicId })
        .from(messages)
        .where(and(eq(messages.userId, this.userId), inArray(messages.id, ids)));

      if (requestedMessages.length === 0) return { messageIds: [], threadIds: [] };

      const requestedMessageIds = new Set(requestedMessages.map(({ id }) => id));
      const topicIds = [
        ...new Set(requestedMessages.map(({ topicId }) => topicId).filter(Boolean)),
      ] as string[];

      const topicThreads =
        topicIds.length > 0
          ? await tx
              .select({
                id: threads.id,
                parentThreadId: threads.parentThreadId,
                sourceMessageId: threads.sourceMessageId,
              })
              .from(threads)
              .where(and(eq(threads.userId, this.userId), inArray(threads.topicId, topicIds)))
          : [];

      const topicMessages =
        topicIds.length > 0
          ? await tx
              .select({ id: messages.id, threadId: messages.threadId })
              .from(messages)
              .where(and(eq(messages.userId, this.userId), inArray(messages.topicId, topicIds)))
          : [];

      const deletedMessageIds = new Set(requestedMessageIds);
      const deletedThreadIds = new Set<string>();

      // A dependent thread can point at a discarded message directly or be nested below another
      // discarded thread. Iterate until both the thread and message closures are stable.
      let changed = true;
      while (changed) {
        changed = false;

        for (const thread of topicThreads) {
          if (deletedThreadIds.has(thread.id)) continue;
          if (
            deletedMessageIds.has(thread.sourceMessageId) ||
            (thread.parentThreadId && deletedThreadIds.has(thread.parentThreadId))
          ) {
            deletedThreadIds.add(thread.id);
            changed = true;
          }
        }

        for (const message of topicMessages) {
          if (
            message.threadId &&
            deletedThreadIds.has(message.threadId) &&
            !deletedMessageIds.has(message.id)
          ) {
            deletedMessageIds.add(message.id);
            changed = true;
          }
        }
      }

      const threadIds = [...deletedThreadIds];
      if (threadIds.length > 0) {
        await tx
          .delete(threads)
          .where(and(eq(threads.userId, this.userId), inArray(threads.id, threadIds)));
      }

      await tx
        .delete(messages)
        .where(
          and(eq(messages.userId, this.userId), inArray(messages.id, [...requestedMessageIds])),
        );

      return { messageIds: [...deletedMessageIds], threadIds };
    });
  };

  deleteMessageTranslate = async (id: string) =>
    this.db
      .delete(messageTranslates)
      .where(and(eq(messageTranslates.id, id), eq(messageTranslates.userId, this.userId)));

  deleteMessageTTS = async (id: string) =>
    this.db
      .delete(messageTTS)
      .where(and(eq(messageTTS.id, id), eq(messageTTS.userId, this.userId)));

  deleteMessageQuery = async (id: string) =>
    this.db
      .delete(messageQueries)
      .where(and(eq(messageQueries.id, id), eq(messageQueries.userId, this.userId)));

  deleteMessagesBySession = async (
    sessionId?: string | null,
    topicId?: string | null,
    groupId?: string | null,
  ) =>
    this.db
      .delete(messages)
      .where(
        and(
          eq(messages.userId, this.userId),
          this.matchSession(sessionId),
          this.matchTopic(topicId),
          this.matchGroup(groupId),
        ),
      );

  deleteAllMessages = async () => {
    return this.db.delete(messages).where(eq(messages.userId, this.userId));
  };

  deleteAllTopicsHistory = async () => {
    return this.db.transaction((transaction) => this.deleteAllTopicsHistoryInTransaction(transaction));
  };

  deleteAllTopicsHistoryInTransaction = async (transaction: Transaction) => {
    const deletedMessages = await transaction
      .delete(messages)
      .where(eq(messages.userId, this.userId))
      .returning({ id: messages.id });
    const deletedTopics = await transaction
      .delete(topics)
      .where(eq(topics.userId, this.userId))
      .returning({ id: topics.id });

    await transaction.delete(messageGroups).where(eq(messageGroups.userId, this.userId));

    return {
      deletedMessageCount: deletedMessages.length,
      deletedTopicCount: deletedTopics.length,
    };
  };

  // **************** Helper *************** //

  private genId = () => idGenerator('messages', 14);

  private matchSession = (sessionId?: string | null) =>
    sessionId ? eq(messages.sessionId, sessionId) : isNull(messages.sessionId);

  private matchTopic = (topicId?: string | null) =>
    topicId ? eq(messages.topicId, topicId) : isNull(messages.topicId);

  private matchGroup = (groupId?: string | null) =>
    groupId ? eq(messages.groupId, groupId) : isNull(messages.groupId);
}
