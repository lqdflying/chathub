import { KnowledgeBaseItem } from '@lobechat/types';
import { isChunkableFile } from '@lobechat/utils';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { NewKnowledgeBase, files, knowledgeBaseFiles, knowledgeBases } from '../schemas';
import { LobeChatDatabase } from '../type';

export class KnowledgeBaseModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // create

  create = async (params: Omit<NewKnowledgeBase, 'userId'>) => {
    const [result] = await this.db
      .insert(knowledgeBases)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  addFilesToKnowledgeBase = async (id: string, fileIds: string[]) => {
    if (fileIds.length === 0) return [];

    return this.db.transaction(async (trx) => {
      const [knowledgeBase, ownedFiles] = await Promise.all([
        trx.query.knowledgeBases.findFirst({
          where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
        }),
        trx
          .select({ fileType: files.fileType, id: files.id, name: files.name })
          .from(files)
          .where(and(inArray(files.id, fileIds), eq(files.userId, this.userId))),
      ]);
      if (!knowledgeBase || ownedFiles.length !== new Set(fileIds).size) {
        throw new Error('Knowledge base or file not found');
      }
      if (ownedFiles.some((file) => !isChunkableFile(file.name, file.fileType))) {
        throw new Error('Only documents supported by the chunking loaders can be added');
      }

      return trx
        .insert(knowledgeBaseFiles)
        .values(
          Array.from(new Set(fileIds)).map((fileId) => ({
            fileId,
            knowledgeBaseId: id,
            userId: this.userId,
          })),
        )
        .onConflictDoNothing()
        .returning();
    });
  };

  // delete
  delete = async (id: string) => {
    return this.db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(knowledgeBases).where(eq(knowledgeBases.userId, this.userId));
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    return this.db
      .delete(knowledgeBaseFiles)
      .where(
        and(
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          inArray(knowledgeBaseFiles.fileId, ids),
          eq(knowledgeBaseFiles.userId, this.userId),
        ),
      );
  };
  // query
  query = async () => {
    const data = await this.db
      .select({
        avatar: knowledgeBases.avatar,
        createdAt: knowledgeBases.createdAt,
        description: knowledgeBases.description,
        id: knowledgeBases.id,
        isPublic: knowledgeBases.isPublic,
        name: knowledgeBases.name,
        settings: knowledgeBases.settings,
        type: knowledgeBases.type,
        updatedAt: knowledgeBases.updatedAt,
      })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.userId, this.userId))
      .orderBy(desc(knowledgeBases.updatedAt));

    return data as KnowledgeBaseItem[];
  };

  findById = async (id: string) => {
    return this.db.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
    });
  };

  // update
  update = async (id: string, value: Partial<KnowledgeBaseItem>) =>
    this.db
      .update(knowledgeBases)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)));

  static findById = async (db: LobeChatDatabase, id: string) =>
    db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, id),
    });
}
