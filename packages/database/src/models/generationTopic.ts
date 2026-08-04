import {
  AsyncTaskStatus,
  GenerationAsset,
  ImageGenerationTopic,
  ImageHistoryHousekeepingInput,
  ImageHistoryHousekeepingPreview,
  ImageHistoryHousekeepingResult,
} from '@lobechat/types';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { FileService } from '@/server/services/file';

import {
  GenerationTopicItem,
  asyncTasks,
  files,
  generationBatches,
  generationTopics,
  generations,
  globalFiles,
} from '../schemas';
import { LobeChatDatabase, Transaction } from '../type';

interface TopicHistorySummary {
  active: boolean;
  filesToDelete: string[];
  id: string;
  latestActivityAt: Date;
  originalFiles: string[];
  topic: GenerationTopicItem;
}

export interface GenerationTopicDeletionResult {
  blockedByActiveTask?: boolean;
  deletedTopic?: GenerationTopicItem;
  filesToDelete: string[];
}

export interface GenerationTopicHousekeepingResult extends ImageHistoryHousekeepingResult {
  filesToDelete: string[];
}

type TopicHistoryDatabase = LobeChatDatabase | Transaction;

export class GenerationTopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.fileService = new FileService(db, userId);
  }

  queryAll = async () => {
    const topics = await this.db
      .select()
      .from(generationTopics)
      .orderBy(desc(generationTopics.updatedAt))
      .where(eq(generationTopics.userId, this.userId));

    return Promise.all(
      topics.map(async (topic) => {
        if (topic.coverUrl) {
          return {
            ...topic,
            coverUrl: await this.fileService.getFullFileUrl(topic.coverUrl),
          };
        }
        return topic;
      }),
    );
  };

  create = async (title: string) => {
    const [newGenerationTopic] = await this.db
      .insert(generationTopics)
      .values({
        title,
        userId: this.userId,
      })
      .returning();

    return newGenerationTopic;
  };

  update = async (
    id: string,
    data: Partial<ImageGenerationTopic>,
  ): Promise<GenerationTopicItem | undefined> => {
    const [updatedTopic] = await this.db
      .update(generationTopics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
      .returning();

    return updatedTopic;
  };

  previewHousekeeping = async (
    input: ImageHistoryHousekeepingInput,
  ): Promise<ImageHistoryHousekeepingPreview> => {
    const cutoffAt = this.getCutoffAt(input);
    const summaries = this.summarizeTopics(await this.queryTopicHistory(this.db));
    const matching = summaries.filter((summary) => this.matchesAge(summary, cutoffAt));

    return {
      cutoffAt,
      deletableTopicCount: matching.filter((summary) => !summary.active).length,
      skippedActiveTopicCount: matching.filter((summary) => summary.active).length,
    };
  };

  /**
   * Delete a topic's history while preserving original generated files.
   * Covers and generation thumbnails are disposable history media and are returned
   * for best-effort object-storage cleanup by the router.
   */
  delete = async (id: string): Promise<GenerationTopicDeletionResult | undefined> => {
    return this.db.transaction(async (tx) => {
      const [lockedTopic] = await tx
        .select({ id: generationTopics.id })
        .from(generationTopics)
        .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
        .for('update');

      if (!lockedTopic) return undefined;

      const summaries = this.summarizeTopics(await this.queryTopicHistory(tx, [id]));
      const summary = summaries[0];
      if (!summary) return undefined;

      if (summary.active) {
        return { blockedByActiveTask: true, filesToDelete: [] };
      }

      const [deletedTopic] = await tx
        .delete(generationTopics)
        .where(and(eq(generationTopics.id, id), eq(generationTopics.userId, this.userId)))
        .returning();

      return {
        deletedTopic,
        filesToDelete: await this.excludeDurableFiles(tx, summary.filesToDelete),
      };
    });
  };

  housekeep = async (
    input: ImageHistoryHousekeepingInput,
  ): Promise<GenerationTopicHousekeepingResult> => {
    const cutoffAt = this.getCutoffAt(input);

    return this.db.transaction(async (tx) => {
      const initialSummaries = this.summarizeTopics(await this.queryTopicHistory(tx));
      const initialMatches = initialSummaries.filter((summary) =>
        this.matchesAge(summary, cutoffAt),
      );

      if (initialMatches.length === 0) {
        return {
          cutoffAt,
          deletableTopicCount: 0,
          deletedTopicIds: [],
          filesToDelete: [],
          skippedActiveTopicCount: 0,
        };
      }

      // Block new Image submissions while the candidate topic rows are rechecked.
      await tx
        .select({ id: generationTopics.id })
        .from(generationTopics)
        .where(
          and(
            eq(generationTopics.userId, this.userId),
            inArray(
              generationTopics.id,
              initialMatches.map((summary) => summary.id),
            ),
          ),
        )
        .for('update');

      const lockedSummaries = this.summarizeTopics(
        await this.queryTopicHistory(
          tx,
          initialMatches.map((summary) => summary.id),
        ),
      );
      const matching = lockedSummaries.filter((summary) => this.matchesAge(summary, cutoffAt));
      const deletable = matching.filter((summary) => !summary.active);
      const skippedActiveTopicCount = matching.length - deletable.length;
      const filesToDelete = await this.excludeDurableFiles(tx, [
        ...new Set(deletable.flatMap((summary) => summary.filesToDelete)),
      ]);
      const deletedTopicIds = deletable.map((summary) => summary.id);

      if (deletedTopicIds.length > 0) {
        await tx
          .delete(generationTopics)
          .where(
            and(
              eq(generationTopics.userId, this.userId),
              inArray(generationTopics.id, deletedTopicIds),
            ),
          );
      }

      return {
        cutoffAt,
        deletableTopicCount: deletedTopicIds.length,
        deletedTopicIds,
        filesToDelete,
        skippedActiveTopicCount,
      };
    });
  };

  private getCutoffAt = (input: ImageHistoryHousekeepingInput) =>
    input.mode === 'all' ? null : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

  private matchesAge = (summary: TopicHistorySummary, cutoffAt: Date | null) =>
    cutoffAt === null || summary.latestActivityAt < cutoffAt;

  private excludeDurableFiles = async (database: TopicHistoryDatabase, candidates: string[]) => {
    if (candidates.length === 0) return [];

    const fileReferences = await database
      .select({ url: files.url })
      .from(files)
      .where(inArray(files.url, candidates));
    const globalFileReferences = await database
      .select({ url: globalFiles.url })
      .from(globalFiles)
      .where(inArray(globalFiles.url, candidates));
    const protectedUrls = new Set(
      [...fileReferences, ...globalFileReferences].map(({ url }) => url),
    );

    return candidates.filter((candidate) => !protectedUrls.has(candidate));
  };

  private queryTopicHistory = async (database: TopicHistoryDatabase, topicIds?: string[]) => {
    return database
      .select({
        asset: generations.asset,
        batchCreatedAt: generationBatches.createdAt,
        batchUpdatedAt: generationBatches.updatedAt,
        generationCreatedAt: generations.createdAt,
        generationUpdatedAt: generations.updatedAt,
        originalFileUrl: files.url,
        taskStatus: asyncTasks.status,
        taskUpdatedAt: asyncTasks.updatedAt,
        topic: generationTopics,
      })
      .from(generationTopics)
      .leftJoin(generationBatches, eq(generationBatches.generationTopicId, generationTopics.id))
      .leftJoin(generations, eq(generations.generationBatchId, generationBatches.id))
      .leftJoin(asyncTasks, eq(asyncTasks.id, generations.asyncTaskId))
      .leftJoin(files, eq(files.id, generations.fileId))
      .where(
        and(
          eq(generationTopics.userId, this.userId),
          topicIds?.length ? inArray(generationTopics.id, topicIds) : undefined,
        ),
      );
  };

  private summarizeTopics = (rows: Awaited<ReturnType<typeof this.queryTopicHistory>>) => {
    const summaries = new Map<string, TopicHistorySummary>();

    for (const row of rows) {
      const topic = row.topic;
      const existing = summaries.get(topic.id);
      const latestActivityAt = [
        topic.updatedAt,
        row.batchCreatedAt,
        row.batchUpdatedAt,
        row.generationCreatedAt,
        row.generationUpdatedAt,
        row.taskUpdatedAt,
      ].reduce<Date>((latest, value) => {
        if (!value) return latest;
        return value > latest ? value : latest;
      }, topic.createdAt);

      const asset = row.asset as GenerationAsset | null;
      const rowFiles = asset?.thumbnailUrl ? [asset.thumbnailUrl] : [];
      const rowOriginalFiles = [asset?.url, row.originalFileUrl].filter(Boolean) as string[];

      if (existing) {
        existing.active ||= [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing].includes(
          row.taskStatus as AsyncTaskStatus,
        );
        existing.latestActivityAt =
          latestActivityAt > existing.latestActivityAt
            ? latestActivityAt
            : existing.latestActivityAt;
        existing.originalFiles = [...new Set([...existing.originalFiles, ...rowOriginalFiles])];
        existing.filesToDelete = [...new Set([...existing.filesToDelete, ...rowFiles])].filter(
          (file) => !existing.originalFiles.includes(file),
        );
        continue;
      }

      const originalFiles = [...new Set(rowOriginalFiles)];
      summaries.set(topic.id, {
        active: [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing].includes(
          row.taskStatus as AsyncTaskStatus,
        ),
        filesToDelete: [
          ...new Set([...(topic.coverUrl ? [topic.coverUrl] : []), ...rowFiles]),
        ].filter((file) => !originalFiles.includes(file)),
        id: topic.id,
        latestActivityAt,
        originalFiles,
        topic,
      });
    }

    return [...summaries.values()];
  };
}
