import {
  FileSource,
  FilesTabs,
  ImageArtifactListInput,
  ImageArtifactListResult,
  QueryFileListParams,
  SortType,
} from '@lobechat/types';
import { isChunkableFile } from '@lobechat/utils';
import { and, asc, count, desc, eq, ilike, inArray, like, notExists, or, sum } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import {
  FileItem,
  NewFile,
  NewGlobalFile,
  chunks,
  documentChunks,
  embeddings,
  fileChunks,
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
} from '../schemas';
import { LobeChatDatabase, Transaction } from '../type';

export class FileModel {
  private readonly userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (
    params: Omit<NewFile, 'id' | 'userId'> & { knowledgeBaseId?: string },
    insertToGlobalFiles?: boolean,
    trx?: Transaction,
  ) => {
    const executeInTransaction = async (tx: Transaction) => {
      if (params.knowledgeBaseId) {
        if (!isChunkableFile(params.name, params.fileType)) {
          throw new Error('Only documents supported by the chunking loaders can be added');
        }
        const knowledgeBase = await tx.query.knowledgeBases.findFirst({
          where: and(
            eq(knowledgeBases.id, params.knowledgeBaseId),
            eq(knowledgeBases.userId, this.userId),
          ),
        });
        if (!knowledgeBase) throw new Error('Knowledge base not found');
      }

      if (insertToGlobalFiles) {
        await tx.insert(globalFiles).values({
          creator: this.userId,
          fileType: params.fileType,
          hashId: params.fileHash!,
          metadata: params.metadata,
          size: params.size,
          url: params.url,
        });
      }

      const result = await tx
        .insert(files)
        .values({ ...params, userId: this.userId })
        .returning();

      const item = result[0];

      if (params.knowledgeBaseId) {
        await tx.insert(knowledgeBaseFiles).values({
          fileId: item.id,
          knowledgeBaseId: params.knowledgeBaseId,
          userId: this.userId,
        });
      }

      return item;
    };

    const result = await (trx
      ? executeInTransaction(trx)
      : this.db.transaction(executeInTransaction));
    return { id: result.id };
  };

  createGlobalFile = async (file: Omit<NewGlobalFile, 'id' | 'userId'>) => {
    return this.db.insert(globalFiles).values(file).returning();
  };

  checkHash = async (hash: string) => {
    const item = await this.db.query.globalFiles.findFirst({
      where: eq(globalFiles.hashId, hash),
    });
    if (!item) return { isExist: false };

    return {
      fileType: item.fileType,
      isExist: true,
      metadata: item.metadata,
      size: item.size,
      url: item.url,
    };
  };

  repairGlobalFile = async (
    hashId: string,
    params: Pick<NewGlobalFile, 'fileType' | 'metadata' | 'size' | 'url'>,
  ) => {
    return this.db.transaction(async (trx) => {
      const [globalFile] = await trx
        .update(globalFiles)
        .set({ ...params, accessedAt: new Date() })
        .where(eq(globalFiles.hashId, hashId))
        .returning();

      if (!globalFile) return;

      await trx.update(files).set(params).where(eq(files.fileHash, hashId));

      return globalFile;
    });
  };

  delete = async (id: string, removeGlobalFile: boolean = true, trx?: Transaction) => {
    const executeInTransaction = async (tx: Transaction) => {
      const file = await this.findById(id, tx);
      if (!file) return;

      const fileHash = file.fileHash!;

      // 2. Delete related chunks
      await this.deleteFileChunks(tx as any, [id]);

      // 3. Delete file record
      await tx.delete(files).where(and(eq(files.id, id), eq(files.userId, this.userId)));

      // Files without a global hash own their storage object directly.
      if (!file.fileHash) return file;

      const result = await tx
        .select({ count: count() })
        .from(files)
        .where(and(eq(files.fileHash, fileHash)));

      const fileCount = result[0].count;

      // delete the file from global file if it is not used by other files
      // if `DISABLE_REMOVE_GLOBAL_FILE` is true, we will not remove the global file
      if (fileCount === 0 && removeGlobalFile) {
        await tx.delete(globalFiles).where(eq(globalFiles.hashId, fileHash));

        return file;
      }
    };

    return await (trx ? executeInTransaction(trx) : this.db.transaction(executeInTransaction));
  };

  deleteGlobalFile = async (hashId: string) => {
    return this.db.delete(globalFiles).where(eq(globalFiles.hashId, hashId));
  };

  countUsage = async () => {
    const result = await this.db
      .select({
        totalSize: sum(files.size),
      })
      .from(files)
      .where(eq(files.userId, this.userId));

    return parseInt(result[0].totalSize!) || 0;
  };

  deleteMany = async (ids: string[], removeGlobalFile: boolean = true) => {
    if (ids.length === 0) return [];

    return await this.db.transaction(async (trx) => {
      // 1. 先获取文件列表，以便返回删除的文件
      const fileList = await trx.query.files.findMany({
        where: and(inArray(files.id, ids), eq(files.userId, this.userId)),
      });

      if (fileList.length === 0) return [];

      // 提取需要检查的文件哈希值
      const cleanupCandidateByHash = new Map<string, FileItem>();
      const unhashedFiles: FileItem[] = [];
      for (const file of fileList) {
        if (!file.fileHash) {
          unhashedFiles.push(file);
        } else if (!cleanupCandidateByHash.has(file.fileHash)) {
          cleanupCandidateByHash.set(file.fileHash, file);
        }
      }
      const hashList = [...cleanupCandidateByHash.keys()];

      // 2. 删除相关的 chunks
      await this.deleteFileChunks(trx as any, ids);

      // 3. 删除文件记录
      await trx.delete(files).where(and(inArray(files.id, ids), eq(files.userId, this.userId)));

      // 如果不需要删除全局文件，则不应删除任何对象存储文件
      if (!removeGlobalFile || hashList.length === 0) return unhashedFiles;

      // 4. 找出不再被引用的哈希值
      const remainingFiles = await trx
        .select({
          fileHash: files.fileHash,
        })
        .from(files)
        .where(inArray(files.fileHash, hashList));

      // 将仍在使用的哈希值放入Set中，便于快速查找
      const usedHashes = new Set(remainingFiles.map((file) => file.fileHash));

      // 找出需要删除的哈希值(不再被任何文件使用的)
      const hashesToDelete = hashList.filter((hash) => !usedHashes.has(hash));

      if (hashesToDelete.length === 0) return unhashedFiles;

      // 5. 删除不再被引用的全局文件
      await trx.delete(globalFiles).where(inArray(globalFiles.hashId, hashesToDelete));

      // 仅返回真正失去最后引用的对象，每个哈希最多一个清理候选项
      return [
        ...unhashedFiles,
        ...hashesToDelete.map((hash) => cleanupCandidateByHash.get(hash)!),
      ];
    });
  };

  clear = async () => {
    return this.db.delete(files).where(eq(files.userId, this.userId));
  };

  query = async ({
    category,
    q,
    sortType,
    sorter,
    knowledgeBaseId,
    chunkableOnly,
    showFilesInKnowledgeBase,
  }: QueryFileListParams = {}) => {
    // 1. query where
    let whereClause = and(
      q ? ilike(files.name, `%${q}%`) : undefined,
      eq(files.userId, this.userId),
    );
    if (category && category !== FilesTabs.All) {
      const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
      whereClause = and(whereClause, ilike(files.fileType, `${fileTypePrefix}%`));
    }

    // 2. order part

    let orderByClause = desc(files.createdAt);
    // create a map for sortable fields
    const sortableFields = {
      createdAt: files.createdAt,
      name: files.name,
      size: files.size,
      updatedAt: files.updatedAt,
    } as const;
    type SortableField = keyof typeof sortableFields;

    if (sorter && sortType && sorter in sortableFields) {
      const sortFunction = sortType.toLowerCase() === SortType.Asc ? asc : desc;
      orderByClause = sortFunction(sortableFields[sorter as SortableField]);
    }

    // 3. build query
    let query = this.db
      .select({
        chunkTaskId: files.chunkTaskId,
        createdAt: files.createdAt,
        embeddingTaskId: files.embeddingTaskId,
        fileType: files.fileType,
        id: files.id,
        name: files.name,
        size: files.size,
        updatedAt: files.updatedAt,
        url: files.url,
      })
      .from(files);

    // 4. add knowledge base query
    if (knowledgeBaseId) {
      // if knowledgeBaseId is provided, it means we are querying files in a knowledge-base

      // @ts-ignore
      query = query.innerJoin(
        knowledgeBaseFiles,
        and(
          eq(files.id, knowledgeBaseFiles.fileId),
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseFiles.userId, this.userId),
        ),
      );
    }
    // 5.if we don't show files in knowledge base, we need exclude files in knowledge base
    else if (!showFilesInKnowledgeBase) {
      whereClause = and(
        whereClause,
        notExists(
          this.db.select().from(knowledgeBaseFiles).where(eq(knowledgeBaseFiles.fileId, files.id)),
        ),
      );
    }

    // or we are just filter in the global files
    const rows = await query.where(whereClause).orderBy(orderByClause);
    return chunkableOnly || knowledgeBaseId
      ? rows.filter((row) => isChunkableFile(row.name, row.fileType))
      : rows;
  };

  queryImageArtifacts = async ({
    page = 1,
    pageSize = 40,
    q,
    sort = 'newest',
  }: ImageArtifactListInput = {}): Promise<ImageArtifactListResult> => {
    const normalizedPage = Math.max(1, Math.floor(page));
    const normalizedPageSize = Math.min(60, Math.max(1, Math.floor(pageSize)));
    const normalizedQuery = q?.trim();
    const escapedQuery = normalizedQuery?.replaceAll(/([%\\_])/g, String.raw`\$1`);
    const whereClause = and(
      eq(files.userId, this.userId),
      eq(files.source, FileSource.ImageGeneration),
      ilike(files.fileType, 'image/%'),
      escapedQuery ? ilike(files.name, `%${escapedQuery}%`) : undefined,
    );
    const orderByClause = sort === 'oldest' ? asc(files.createdAt) : desc(files.createdAt);
    const offset = (normalizedPage - 1) * normalizedPageSize;

    const [rows, totalResult] = await Promise.all([
      this.db
        .select({
          createdAt: files.createdAt,
          fileType: files.fileType,
          id: files.id,
          metadata: files.metadata,
          name: files.name,
          size: files.size,
          url: files.url,
        })
        .from(files)
        .where(whereClause)
        .orderBy(orderByClause, asc(files.id))
        .limit(normalizedPageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(files).where(whereClause),
    ]);

    const items = rows.map(({ metadata, ...item }) => {
      const dimensions =
        metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
      const width = typeof dimensions.width === 'number' ? dimensions.width : null;
      const height = typeof dimensions.height === 'number' ? dimensions.height : null;

      return { ...item, height, width };
    });

    return {
      items,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total: Number(totalResult[0]?.count ?? 0),
    };
  };

  findByIds = async (ids: string[]) => {
    return this.db.query.files.findMany({
      where: and(inArray(files.id, ids), eq(files.userId, this.userId)),
    });
  };

  findById = async (id: string, trx?: Transaction) => {
    const database = trx || this.db;
    return database.query.files.findFirst({
      where: and(eq(files.id, id), eq(files.userId, this.userId)),
    });
  };

  countFilesByHash = async (hash: string) => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(files)
      .where(and(eq(files.fileHash, hash)));

    return result[0].count;
  };

  update = async (id: string, value: Partial<FileItem>) =>
    this.db
      .update(files)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(files.id, id), eq(files.userId, this.userId)));

  /**
   * get the corresponding file type prefix according to FilesTabs
   */
  private getFileTypePrefix = (category: FilesTabs): string => {
    switch (category) {
      case FilesTabs.Audios: {
        return 'audio';
      }
      case FilesTabs.Documents: {
        return 'application';
      }
      case FilesTabs.Images: {
        return 'image';
      }
      case FilesTabs.Videos: {
        return 'video';
      }
      default: {
        return '';
      }
    }
  };

  /**
   * Legacy rows may store the full storage URL instead of the bare key
   * (https://github.com/lobehub/lobe-chat/issues/8994). Return this user's url values that
   * match the key exactly (normal rows) or whose storage path ends in `/<key>` (legacy
   * full URLs, optionally followed by a presigned query string). Matching the trailing
   * slash boundary avoids a bare `%key%` contains-match, which for a short key would match
   * nearly every row and could push the real match past the row limit. The caller confirms
   * legacy candidates by extracting the key from the stored URL.
   */
  findUrlCandidatesByKey = async (key: string): Promise<string[]> => {
    const escapedKey = key.replaceAll(/([%\\_])/g, String.raw`\$1`);
    const rows = await this.db
      .select({ url: files.url })
      .from(files)
      .where(
        and(
          eq(files.userId, this.userId),
          or(
            eq(files.url, key),
            like(files.url, `%/${escapedKey}`),
            like(files.url, `%/${escapedKey}?%`),
          ),
        ),
      )
      .limit(20);

    return rows.map((row) => row.url).filter(Boolean) as string[];
  };

  findByNames = async (fileNames: string[]) =>
    this.db.query.files.findMany({
      where: and(
        or(...fileNames.map((name) => like(files.name, `${name}%`))),
        eq(files.userId, this.userId),
      ),
    });

  // 抽象出通用的删除 chunks 方法
  private deleteFileChunks = async (trx: PgTransaction<any>, fileIds: string[]) => {
    if (fileIds.length === 0) return;

    // 获取要删除的文件相关的所有 chunk IDs（移除知识库保护逻辑）
    const relatedChunks = await trx
      .select({ chunkId: fileChunks.chunkId })
      .from(fileChunks)
      .where(inArray(fileChunks.fileId, fileIds));

    const chunkIds = relatedChunks.map((c) => c.chunkId).filter(Boolean) as string[];

    if (chunkIds.length === 0) return;

    // 批量处理配置
    const BATCH_SIZE = 1000;
    const MAX_CONCURRENT_BATCHES = 3;

    // 分批并行处理
    for (let i = 0; i < chunkIds.length; i += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
      const batchPromises = [];

      // 创建多个并行批次
      for (let j = 0; j < MAX_CONCURRENT_BATCHES; j++) {
        const startIdx = i + j * BATCH_SIZE;
        if (startIdx >= chunkIds.length) break;

        const batchChunkIds = chunkIds.slice(startIdx, startIdx + BATCH_SIZE);
        if (batchChunkIds.length === 0) continue;

        // 按正确的删除顺序处理每个批次，失败不阻止流程
        const batchPromise = (async () => {
          // 1. 删除 embeddings (最顶层，有外键依赖)
          try {
            await trx.delete(embeddings).where(inArray(embeddings.chunkId, batchChunkIds));
          } catch (e) {
            // 静默处理，不阻止删除流程
            console.warn('Failed to delete embeddings:', e);
          }

          // 2. 删除 documentChunks 关联 (如果存在)
          try {
            await trx.delete(documentChunks).where(inArray(documentChunks.chunkId, batchChunkIds));
          } catch (e) {
            // 静默处理，不阻止删除流程
            console.warn('Failed to delete documentChunks:', e);
          }

          // 3. 删除 chunks (核心数据)
          try {
            await trx.delete(chunks).where(inArray(chunks.id, batchChunkIds));
          } catch (e) {
            // 静默处理，不阻止删除流程
            console.warn('Failed to delete chunks:', e);
          }
        })();

        batchPromises.push(batchPromise);
      }

      // 等待当前批次的所有任务完成
      await Promise.all(batchPromises);
    }

    // 4. 最后删除 fileChunks 关联表记录
    try {
      await trx.delete(fileChunks).where(inArray(fileChunks.fileId, fileIds));
    } catch (e) {
      // 静默处理，不阻止删除流程
      console.warn('Failed to delete fileChunks:', e);
    }

    return chunkIds;
  };
}
