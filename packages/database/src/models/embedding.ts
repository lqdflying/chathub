import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';

import { NewEmbeddingsItem, embeddings, fileChunks, files } from '../schemas';
import { LobeChatDatabase } from '../type';

export class EmbeddingModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (value: Omit<NewEmbeddingsItem, 'userId'>) => {
    const [item] = await this.db
      .insert(embeddings)
      .values({ ...value, userId: this.userId })
      .returning();

    return item.id as string;
  };

  bulkCreate = async (
    values: Omit<NewEmbeddingsItem, 'userId'>[],
    taskGuard?: { fileId: string; taskId: string },
  ) => {
    if (values.length === 0) return [];

    const chunkIds = values.map(({ chunkId }) => chunkId).filter(Boolean) as string[];

    return this.db.transaction(async (trx) => {
      if (taskGuard) {
        const [file] = await trx
          .select({ embeddingTaskId: files.embeddingTaskId })
          .from(files)
          .where(and(eq(files.id, taskGuard.fileId), eq(files.userId, this.userId)))
          .for('update');

        if (!file || file.embeddingTaskId !== taskGuard.taskId) {
          throw new Error('Embedding task was superseded by a newer request.');
        }
      }

      if (chunkIds.length > 0) {
        await trx
          .delete(embeddings)
          .where(and(eq(embeddings.userId, this.userId), inArray(embeddings.chunkId, chunkIds)));
      }

      return trx
        .insert(embeddings)
        .values(values.map((item) => ({ ...item, userId: this.userId })))
        .returning();
    });
  };

  delete = async (id: string) => {
    return this.db
      .delete(embeddings)
      .where(and(eq(embeddings.id, id), eq(embeddings.userId, this.userId)));
  };

  query = async () => {
    return this.db.query.embeddings.findMany({
      where: eq(embeddings.userId, this.userId),
    });
  };

  findById = async (id: string) => {
    return this.db.query.embeddings.findFirst({
      where: and(eq(embeddings.id, id), eq(embeddings.userId, this.userId)),
    });
  };

  countUsage = async (): Promise<number> => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(embeddings)
      .where(eq(embeddings.userId, this.userId));

    return result[0].count;
  };

  countChunkUsage = async (): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(embeddings)
      .where(and(eq(embeddings.userId, this.userId), isNotNull(embeddings.chunkId)));

    return result[0].count;
  };

  countByFileId = async (fileId: string, model: string): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(embeddings)
      .innerJoin(
        fileChunks,
        and(eq(embeddings.chunkId, fileChunks.chunkId), eq(fileChunks.userId, this.userId)),
      )
      .where(
        and(
          eq(fileChunks.fileId, fileId),
          eq(embeddings.model, model),
          eq(embeddings.userId, this.userId),
        ),
      );

    return result[0].count;
  };

  countByFileIds = async (fileIds: string[], model: string) => {
    if (fileIds.length === 0) return [];

    return this.db
      .select({ count: count(), id: fileChunks.fileId })
      .from(embeddings)
      .innerJoin(
        fileChunks,
        and(eq(embeddings.chunkId, fileChunks.chunkId), eq(fileChunks.userId, this.userId)),
      )
      .where(
        and(
          inArray(fileChunks.fileId, fileIds),
          eq(embeddings.model, model),
          eq(embeddings.userId, this.userId),
        ),
      )
      .groupBy(fileChunks.fileId);
  };
}
