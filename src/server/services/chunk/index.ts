import { LobeChatDatabase } from '@lobechat/database';
import { ClientSecretPayload } from '@lobechat/types';
import { isChunkableFile } from '@lobechat/utils';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import {
  describeKnowledgeDebugError,
  getKnowledgeDebugContext,
  logKnowledgeDebugSafe,
  runWithKnowledgeDebugOperation,
} from '@/libs/logger/knowledgeDebug';
import { ChunkContentParams, ContentChunk } from '@/server/modules/ContentChunk';
import { createAsyncCaller } from '@/server/routers/async';
import { RagProviderNotConfiguredError, resolveRagEmbeddingConfig } from '@/server/services/rag';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

export class ChunkService {
  private db: LobeChatDatabase;
  private userId: string;
  private chunkClient: ContentChunk;
  private fileModel: FileModel;
  private asyncTaskModel: AsyncTaskModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.db = serverDB;
    this.userId = userId;

    this.chunkClient = new ContentChunk();

    this.fileModel = new FileModel(serverDB, userId);
    this.asyncTaskModel = new AsyncTaskModel(serverDB, userId);
  }

  async chunkContent(params: ChunkContentParams) {
    return this.chunkClient.chunkContent(params);
  }

  async asyncEmbeddingFileChunks(fileId: string, payload: ClientSecretPayload) {
    return runWithKnowledgeDebugOperation(
      { operation: 'embedding_task', runtime: 'lambda', transport: 'internal_http' },
      async () => {
        const startedAt = Date.now();
        const result = await this.fileModel.findById(fileId);

        if (!result) return;
        if (!isChunkableFile(result.name, result.fileType)) {
          throw new Error('This file format is not supported by the Knowledge Base chunkers.');
        }

        const resolved = await resolveRagEmbeddingConfig(this.db, this.userId);
        if (!resolved.config) throw new RagProviderNotConfiguredError();

        // 1. create a asyncTaskId
        const asyncTaskId = await this.asyncTaskModel.create({
          status: AsyncTaskStatus.Pending,
          type: AsyncTaskType.Embedding,
        });

        await this.fileModel.update(fileId, { embeddingTaskId: asyncTaskId });

        logKnowledgeDebugSafe('reindex_started', {
          phase: 'embedding_task',
          taskId: asyncTaskId,
        });

        const asyncCaller = await createAsyncCaller({ jwtPayload: payload, userId: this.userId });

        // trigger embedding task asynchronously
        try {
          logKnowledgeDebugSafe('task_dispatch_started', {
            phase: 'embedding_dispatch',
            taskId: asyncTaskId,
          });
          await asyncCaller.file.embeddingChunks({ fileId, taskId: asyncTaskId });
          logKnowledgeDebugSafe('task_dispatch_settled', {
            durationMs: Date.now() - startedAt,
            outcome: 'completed',
            phase: 'embedding_dispatch',
            taskId: asyncTaskId,
          });
        } catch (e) {
          console.error('[embeddingFileChunks] error:', e);

          logKnowledgeDebugSafe('task_dispatch_settled', {
            ...describeKnowledgeDebugError(e),
            durationMs: Date.now() - startedAt,
            outcome: 'failed',
            phase: 'embedding_dispatch',
            taskId: asyncTaskId,
          });

          await this.asyncTaskModel.update(asyncTaskId, {
            error: new AsyncTaskError(
              AsyncTaskErrorType.TaskTriggerError,
              'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
              getKnowledgeDebugContext()?.diagnosticId,
            ),
            status: AsyncTaskStatus.Error,
          });
        }

        return asyncTaskId;
      },
    );
  }

  /**
   * parse file to chunks with async task
   */
  async asyncParseFileToChunks(fileId: string, payload: ClientSecretPayload, skipExist?: boolean) {
    return runWithKnowledgeDebugOperation(
      { operation: 'chunking_task', runtime: 'lambda', transport: 'internal_http' },
      async () => {
        const startedAt = Date.now();
        const result = await this.fileModel.findById(fileId);

        if (!result) return;
        if (!isChunkableFile(result.name, result.fileType)) {
          throw new Error('This file format is not supported by the Knowledge Base chunkers.');
        }

        // skip if already exist chunk tasks
        if (skipExist && result.chunkTaskId) return;

        // 1. create a asyncTaskId
        await this.fileModel.update(fileId, { embeddingTaskId: null });
        const asyncTaskId = await this.asyncTaskModel.create({
          status: AsyncTaskStatus.Processing,
          type: AsyncTaskType.Chunking,
        });

        await this.fileModel.update(fileId, { chunkTaskId: asyncTaskId });

        const asyncCaller = await createAsyncCaller({ jwtPayload: payload, userId: this.userId });

        // trigger parse file task asynchronously
        logKnowledgeDebugSafe('task_dispatch_started', {
          phase: 'chunking_dispatch',
          taskId: asyncTaskId,
        });
        asyncCaller.file
          .parseFileToChunks({ fileId: fileId, taskId: asyncTaskId })
          .then(() => {
            logKnowledgeDebugSafe('task_dispatch_settled', {
              durationMs: Date.now() - startedAt,
              outcome: 'completed',
              phase: 'chunking_dispatch',
              taskId: asyncTaskId,
            });
          })
          .catch(async (e) => {
            console.error('[ParseFileToChunks] error:', e);

            logKnowledgeDebugSafe('task_dispatch_settled', {
              ...describeKnowledgeDebugError(e),
              durationMs: Date.now() - startedAt,
              outcome: 'failed',
              phase: 'chunking_dispatch',
              taskId: asyncTaskId,
            });

            await this.asyncTaskModel.update(asyncTaskId, {
              error: new AsyncTaskError(
                AsyncTaskErrorType.TaskTriggerError,
                'trigger file chunking async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
                getKnowledgeDebugContext()?.diagnosticId,
              ),
              status: AsyncTaskStatus.Error,
            });
          });

        return asyncTaskId;
      },
    );
  }
}
