import {
  AsyncTaskStatus,
  ChunkDisplayMetadata,
  ChunkMetadata,
  FileChunk,
  RAG_CHAT_CANDIDATE_LIMIT,
  RAG_CHAT_MINIMUM_SIMILARITY,
  RAG_CHAT_RESULT_LIMIT,
  RagChatRetrievalStats,
} from '@lobechat/types';
import { and, asc, cosineDistance, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { chunk } from 'lodash-es';

import {
  NewChunkItem,
  NewUnstructuredChunkItem,
  asyncTasks,
  chunks,
  embeddings,
  fileChunks,
  files,
  unstructuredChunks,
} from '../schemas';
import { LobeChatDatabase } from '../type';

export class ChunkModel {
  private userId: string;

  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  bulkCreate = async (params: NewChunkItem[], fileId: string) => {
    return this.db.transaction(async (trx) => {
      if (params.length === 0) return [];

      const result = await trx.insert(chunks).values(params).returning();

      const fileChunksData = result.map((chunk) => ({
        chunkId: chunk.id,
        fileId,
        userId: this.userId,
      }));

      if (fileChunksData.length > 0) {
        await trx.insert(fileChunks).values(fileChunksData);
      }

      return result;
    });
  };

  replaceFileChunks = async (
    params: NewChunkItem[],
    fileId: string,
    unstructuredParams: NewUnstructuredChunkItem[] = [],
  ) => {
    return this.db.transaction(async (trx) => {
      const ownedFile = await trx.query.files.findFirst({
        where: and(eq(files.id, fileId), eq(files.userId, this.userId)),
      });
      if (!ownedFile) throw new Error('File not found');

      const previous = await trx
        .select({ id: chunks.id })
        .from(chunks)
        .innerJoin(
          fileChunks,
          and(eq(fileChunks.chunkId, chunks.id), eq(fileChunks.userId, this.userId)),
        )
        .where(and(eq(fileChunks.fileId, fileId), eq(chunks.userId, this.userId)));

      await trx
        .delete(unstructuredChunks)
        .where(
          and(eq(unstructuredChunks.fileId, fileId), eq(unstructuredChunks.userId, this.userId)),
        );

      const previousIds = previous.map(({ id }) => id);
      if (previousIds.length > 0) {
        await trx
          .delete(chunks)
          .where(and(inArray(chunks.id, previousIds), eq(chunks.userId, this.userId)));
      }

      const cleanChunks = params
        .filter(({ text }) => !!text?.trim())
        .map((item) => ({ ...item, text: item.text!.trim(), userId: this.userId }));
      if (cleanChunks.length === 0) return [];

      const result = await trx.insert(chunks).values(cleanChunks).returning();
      await trx
        .insert(fileChunks)
        .values(result.map(({ id }) => ({ chunkId: id, fileId, userId: this.userId })));

      const cleanUnstructured = unstructuredParams
        .filter(({ text }) => !!text?.trim())
        .map((item) => ({ ...item, fileId, text: item.text!.trim(), userId: this.userId }));
      if (cleanUnstructured.length > 0) {
        await trx.insert(unstructuredChunks).values(cleanUnstructured);
      }

      return result;
    });
  };

  bulkCreateUnstructuredChunks = async (params: NewUnstructuredChunkItem[]) => {
    return this.db.insert(unstructuredChunks).values(params);
  };

  delete = async (id: string) => {
    return this.db.delete(chunks).where(and(eq(chunks.id, id), eq(chunks.userId, this.userId)));
  };

  deleteOrphanChunks = async () => {
    const orphanedChunks = await this.db
      .select({ chunkId: chunks.id })
      .from(chunks)
      .leftJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(isNull(fileChunks.fileId));

    const ids = orphanedChunks.map((chunk) => chunk.chunkId);
    if (ids.length === 0) return;

    const list = chunk(ids, 500);

    await this.db.transaction(async (trx) => {
      await Promise.all(
        list.map(async (chunkIds) => {
          await trx.delete(chunks).where(inArray(chunks.id, chunkIds));
        }),
      );
    });
  };

  findById = async (id: string) => {
    return this.db.query.chunks.findFirst({
      where: and(eq(chunks.id, id), eq(chunks.userId, this.userId)),
    });
  };

  findByFileId = async (id: string, page = 0) => {
    const data = await this.db
      .select({
        abstract: chunks.abstract,
        createdAt: chunks.createdAt,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        text: chunks.text,
        type: chunks.type,
        updatedAt: chunks.updatedAt,
      })
      .from(chunks)
      .innerJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(and(eq(fileChunks.fileId, id), eq(chunks.userId, this.userId)))
      .limit(20)
      .offset(page * 20)
      .orderBy(asc(chunks.index));

    return data.map((item) => {
      const metadata = item.metadata as ChunkMetadata;

      return { ...item, metadata, pageNumber: metadata?.pageNumber } as FileChunk;
    });
  };

  getChunksTextByFileId = async (id: string): Promise<{ id: string; text: string }[]> => {
    const data = await this.db
      .select()
      .from(chunks)
      .innerJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(
        and(
          eq(fileChunks.fileId, id),
          eq(fileChunks.userId, this.userId),
          eq(chunks.userId, this.userId),
        ),
      );

    return data
      .map((item) => item.chunks)
      .map((chunk) => ({ id: chunk.id, text: this.mapChunkText(chunk) }))
      .filter((chunk) => chunk.text) as { id: string; text: string }[];
  };

  findAllByFileId = async (
    id: string,
  ): Promise<
    {
      id: string;
      index: number | null;
      metadata: ChunkDisplayMetadata | null;
      text: string;
      type: string | null;
    }[]
  > => {
    const data = await this.db
      .select({
        id: chunks.id,
        index: chunks.index,
        metadata: sql<ChunkDisplayMetadata | null>`
          nullif(
            jsonb_strip_nulls(
              jsonb_build_object(
                'converted_by', ${chunks.metadata} ->> 'converted_by',
                'source_file_type', ${chunks.metadata} ->> 'source_file_type',
                'source_title', ${chunks.metadata} ->> 'source_title'
              )
            ),
            '{}'::jsonb
          )
        `,
        text: chunks.text,
        type: chunks.type,
      })
      .from(chunks)
      .innerJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(
        and(
          eq(fileChunks.fileId, id),
          eq(fileChunks.userId, this.userId),
          eq(chunks.userId, this.userId),
        ),
      )
      .orderBy(asc(chunks.index));

    // Keep raw chunk text for user-facing Markdown renderers. `mapChunkText`
    // adds LLM-only Table scaffolding that would render as literal markup.
    return data
      .filter((item) => item.text)
      .map((item) => ({
        ...item,
        text: item.text as string,
      }));
  };

  countByFileIds = async (ids: string[]) => {
    if (ids.length === 0) return [];

    return this.db
      .select({
        count: count(fileChunks.chunkId),
        id: fileChunks.fileId,
      })
      .from(fileChunks)
      .where(and(inArray(fileChunks.fileId, ids), eq(fileChunks.userId, this.userId)))
      .groupBy(fileChunks.fileId);
  };

  countByFileId = async (ids: string) => {
    const data = await this.db
      .select({
        count: count(fileChunks.chunkId),
        id: fileChunks.fileId,
      })
      .from(fileChunks)
      .where(and(eq(fileChunks.fileId, ids), eq(fileChunks.userId, this.userId)))
      .groupBy(fileChunks.fileId);

    return data[0]?.count ?? 0;
  };

  semanticSearch = async ({
    embedding,
    fileIds,
    fingerprint,
  }: {
    embedding: number[];
    fileIds: string[] | undefined;
    fingerprint?: string;
    query: string;
  }) => {
    const distance = cosineDistance(embeddings.embeddings, embedding);
    const similarity = sql<number>`1 - (${distance})`;

    const data = await this.db
      .select({
        fileId: fileChunks.fileId,
        fileName: files.name,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        similarity,
        text: chunks.text,
        type: chunks.type,
      })
      .from(chunks)
      .innerJoin(
        embeddings,
        and(
          eq(chunks.id, embeddings.chunkId),
          eq(embeddings.userId, this.userId),
          fingerprint ? eq(embeddings.model, fingerprint) : undefined,
        ),
      )
      .innerJoin(
        fileChunks,
        and(eq(chunks.id, fileChunks.chunkId), eq(fileChunks.userId, this.userId)),
      )
      .innerJoin(files, and(eq(fileChunks.fileId, files.id), eq(files.userId, this.userId)))
      .leftJoin(
        asyncTasks,
        and(eq(files.embeddingTaskId, asyncTasks.id), eq(asyncTasks.userId, this.userId)),
      )
      .where(
        and(
          eq(chunks.userId, this.userId),
          isNotNull(embeddings.chunkId),
          fileIds ? inArray(files.id, fileIds) : undefined,
          fingerprint ? eq(asyncTasks.status, AsyncTaskStatus.Success) : undefined,
        ),
      )
      // pgvector requires the raw distance operator in ascending order for
      // the HNSW index to participate in nearest-neighbor retrieval.
      .orderBy(distance)
      .limit(RAG_CHAT_CANDIDATE_LIMIT);

    return data
      .filter(({ similarity }) => similarity >= RAG_CHAT_MINIMUM_SIMILARITY)
      .slice(0, RAG_CHAT_RESULT_LIMIT)
      .map((item) => ({
        ...item,
        metadata: item.metadata as ChunkMetadata,
      }));
  };

  semanticSearchForChat = async ({
    embedding,
    fileIds,
    fingerprint,
  }: {
    embedding: number[];
    fileIds: string[] | undefined;
    fingerprint?: string;
    query: string;
  }) => {
    const { chunks } = await this.semanticSearchForChatWithStats({
      embedding,
      fileIds,
      fingerprint,
      query: '',
    });

    return chunks;
  };

  semanticSearchForChatWithStats = async ({
    embedding,
    fileIds,
    fingerprint,
  }: {
    embedding: number[];
    fileIds: string[] | undefined;
    fingerprint?: string;
    query: string;
  }) => {
    const distance = cosineDistance(embeddings.embeddings, embedding);
    const similarity = sql<number>`1 - (${distance})`;

    const hasFiles = fileIds && fileIds.length > 0;

    if (!hasFiles) {
      return {
        chunks: [],
        stats: {
          candidateCount: 0,
          candidateLimit: RAG_CHAT_CANDIDATE_LIMIT,
          eligibleCount: 0,
          minimumSimilarity: RAG_CHAT_MINIMUM_SIMILARITY,
          resultLimit: RAG_CHAT_RESULT_LIMIT,
          selectedCount: 0,
          selectedScores: [],
          strategy: 'cosine',
        } satisfies RagChatRetrievalStats,
      };
    }

    const result = await this.db
      .select({
        fileId: files.id,
        fileName: files.name,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        similarity,
        text: chunks.text,
        type: chunks.type,
      })
      .from(chunks)
      .innerJoin(
        embeddings,
        and(
          eq(chunks.id, embeddings.chunkId),
          eq(embeddings.userId, this.userId),
          fingerprint ? eq(embeddings.model, fingerprint) : undefined,
        ),
      )
      .innerJoin(
        fileChunks,
        and(eq(chunks.id, fileChunks.chunkId), eq(fileChunks.userId, this.userId)),
      )
      .innerJoin(files, and(eq(files.id, fileChunks.fileId), eq(files.userId, this.userId)))
      .leftJoin(
        asyncTasks,
        and(eq(files.embeddingTaskId, asyncTasks.id), eq(asyncTasks.userId, this.userId)),
      )
      .where(
        and(
          eq(chunks.userId, this.userId),
          isNotNull(embeddings.chunkId),
          inArray(files.id, fileIds),
          fingerprint ? eq(asyncTasks.status, AsyncTaskStatus.Success) : undefined,
        ),
      )
      .orderBy(distance)
      .limit(RAG_CHAT_CANDIDATE_LIMIT);

    const eligible = result.filter(({ similarity }) => similarity >= RAG_CHAT_MINIMUM_SIMILARITY);
    const selected = eligible.slice(0, RAG_CHAT_RESULT_LIMIT);
    const mappedChunks = selected.map((item) => {
      return {
        fileId: item.fileId,
        fileName: item.fileName,
        id: item.id,
        index: item.index,
        similarity: item.similarity,
        text: this.mapChunkText(item),
      };
    });

    return {
      chunks: mappedChunks,
      stats: {
        candidateCount: result.length,
        candidateLimit: RAG_CHAT_CANDIDATE_LIMIT,
        eligibleCount: eligible.length,
        minimumSimilarity: RAG_CHAT_MINIMUM_SIMILARITY,
        resultLimit: RAG_CHAT_RESULT_LIMIT,
        selectedCount: mappedChunks.length,
        selectedScores: selected.map(({ similarity }) => similarity),
        strategy: 'cosine',
      } satisfies RagChatRetrievalStats,
    };
  };

  private mapChunkText = (chunk: { metadata: any; text: string | null; type: string | null }) => {
    let text = chunk.text;

    if (chunk.type === 'Table') {
      text = `${chunk.text}

content in Table html is below:
${(chunk.metadata as ChunkMetadata).text_as_html}
`;
    }

    return text;
  };
}
