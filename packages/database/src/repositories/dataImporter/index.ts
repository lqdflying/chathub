import { and, eq, getTableColumns } from 'drizzle-orm';
import { Md5 } from 'ts-md5';

import {
  DataBackupTable,
  DataImportStrategy,
  ImportPgDataStructure,
  parseDatabaseBackup,
} from '@/types/export';
import { ImportResultData, ImporterEntryData } from '@/types/importer';

import { LobeChatDatabase } from '../../type';
import { sortMessagesParentFirst } from '../../utils/sortMessagesParentFirst';
import {
  BackupRelation,
  DATA_BACKUP_REGISTRY,
  DATA_BACKUP_TABLE_OBJECTS,
  DataBackupTableConfig,
} from '../dataBackupRegistry';
import { DeprecatedDataImporterRepos } from './deprecated';

interface ImportResult {
  added: number;
  errors: number;
  skips: number;
  updated: number;
}

interface DeferredRecord {
  config: DataBackupTableConfig;
  source: Record<string, any>;
  targetId: string;
}

type CompatibleImportStrategy = DataImportStrategy | 'override' | 'skip';

const EMPTY_RESULT = (): ImportResult => ({ added: 0, errors: 0, skips: 0, updated: 0 });

const hasChanges = (result: ImportResult) =>
  result.added > 0 || result.skips > 0 || result.updated > 0;

export class DataImporterRepos {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly deprecatedDataImporterRepos: DeprecatedDataImporterRepos;
  private idMaps: Partial<Record<DataBackupTable, Record<string, string>>> = {};
  private deferredRecords: DeferredRecord[] = [];

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.deprecatedDataImporterRepos = new DeprecatedDataImporterRepos(db, userId);
  }

  importData = async (data: ImporterEntryData): Promise<ImportResultData> => {
    const results = await this.deprecatedDataImporterRepos.importData(data);
    return { results, success: true };
  };

  /**
   * Transaction-owning entry point for client DB and repository callers.
   * Server callers that already hold the conversation lock must use
   * importPgDataInTransaction to avoid a nested transaction/savepoint.
   */
  async importPgData(
    input: ImportPgDataStructure,
    strategy: CompatibleImportStrategy = 'merge',
  ): Promise<ImportResultData> {
    try {
      return await this.db.transaction(async (transaction) =>
        new DataImporterRepos(transaction as LobeChatDatabase, this.userId).importPgDataInTransaction(
          input,
          strategy,
        ),
      );
    } catch (error) {
      console.error('[data-backup] import failed and was rolled back:', error);
      return {
        error: {
          details: error instanceof Error ? error.stack : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        results: {},
        success: false,
      };
    }
  }

  /**
   * Imports into the supplied transaction and deliberately lets every error
   * escape. This guarantees the transaction owner can roll back the full
   * restore instead of committing partially imported tables.
   */
  async importPgDataInTransaction(
    input: ImportPgDataStructure,
    strategy: CompatibleImportStrategy = 'merge',
  ): Promise<ImportResultData> {
    const { backup } = parseDatabaseBackup(input);
    const normalizedStrategy: DataImportStrategy =
      strategy === 'override' || strategy === 'replace' ? 'replace' : 'merge';
    const results: Record<string, ImportResult> = {};

    this.idMaps = {};
    this.deferredRecords = [];

    if (normalizedStrategy === 'replace') await this.deleteCurrentBackupData();

    for (const config of DATA_BACKUP_REGISTRY) {
      const tableData = backup.data[config.table] || [];
      if (tableData.length === 0) continue;
      if (config.idStrategy === 'singleton' && tableData.length > 1) {
        throw new Error(`Backup table ${config.table} contains multiple singleton records`);
      }

      const result = await this.importTable(config, tableData);
      if (hasChanges(result)) results[config.table] = result;
    }

    await this.restoreDeferredRelationships();

    return { results, success: true };
  }

  private getIdMap(table: DataBackupTable): Record<string, string> {
    this.idMaps[table] ||= {};
    return this.idMaps[table]!;
  }

  private createStableImportedId(table: DataBackupTable, sourceId: string): string {
    const digest = Md5.hashStr(`${this.userId}:${table}:${sourceId}`);
    const prefix = sourceId.includes('_') ? sourceId.split('_', 1)[0] : 'import';
    return `${prefix}_${digest}`;
  }

  private async deleteCurrentBackupData() {
    for (const config of [...DATA_BACKUP_REGISTRY].reverse()) {
      if (config.table === 'users') continue;

      const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
      await (this.db as any)
        .delete(table)
        .where(eq(table[config.userField], this.userId));
    }
  }

  private async getExistingRows(config: DataBackupTableConfig): Promise<Record<string, any>[]> {
    const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;

    return (this.db as any)
      .select()
      .from(table)
      .where(eq(table[config.userField], this.userId));
  }

  private findExistingGeneratedRecord(
    existingRows: Record<string, any>[],
    source: Record<string, any>,
    stableId: string,
  ) {
    const sourceIdentity = source.clientId || source.id;

    return existingRows.find(
      (row) =>
        row.id === source.id ||
        row.id === stableId ||
        (sourceIdentity && row.clientId && row.clientId === sourceIdentity),
    );
  }

  private findExistingConflict(
    existingRows: Record<string, any>[],
    conflictFields: string[],
    record: Record<string, any>,
  ) {
    return existingRows.find((existing) =>
      conflictFields.every((field) => existing[field] === record[field]),
    );
  }

  private convertColumnValue(
    column: { dataType?: string },
    field: string,
    value: unknown,
  ): unknown {
    if (value === null || value === undefined) return value;
    if (column.dataType !== 'date') return value;

    const date = value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date value for ${field}`);

    return date;
  }

  private mapRelationValue(relation: BackupRelation, value: unknown): unknown {
    if (value === null || value === undefined) return value;

    const mappedId = this.getIdMap(relation.sourceTable)[String(value)];
    if (!mappedId) {
      throw new Error(
        `Backup relationship is incomplete: ${relation.sourceTable}.${String(value)} is missing`,
      );
    }

    return mappedId;
  }

  private prepareRecord(
    config: DataBackupTableConfig,
    source: Record<string, any>,
    targetId?: string,
  ): Record<string, any> {
    const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
    const columns = getTableColumns(table) as Record<string, any>;
    const record: Record<string, any> = {};

    for (const [field, column] of Object.entries(columns)) {
      if (field === config.userField || field === 'messageOrder') continue;
      if (!(field in source)) continue;

      record[field] = this.convertColumnValue(column, field, source[field]);
    }

    if ('userId' in columns) record.userId = this.userId;
    if (config.userField === 'id' && config.table === 'userSettings') record.id = this.userId;
    if (targetId) record.id = targetId;

    if (config.idStrategy === 'generated' && 'clientId' in columns) {
      record.clientId = source.clientId || source.id;
    }

    for (const relation of config.relations || []) {
      if (
        !(relation.field in record) ||
        record[relation.field] === null ||
        record[relation.field] === undefined
      )
        continue;

      if (relation.deferred) {
        // threads.sourceMessageId is required but intentionally has no FK, so
        // retain the source ID as a temporary value until messages are mapped.
        record[relation.field] =
          config.table === 'threads' && relation.field === 'sourceMessageId'
            ? record[relation.field]
            : null;
      } else {
        record[relation.field] = this.mapRelationValue(relation, record[relation.field]);
      }
    }

    if (config.table === 'topics' && !record.lastActivityAt) {
      record.lastActivityAt = record.updatedAt || record.createdAt || new Date(0);
    }

    if (config.table === 'userMemoriesContexts' && Array.isArray(record.userMemoryIds)) {
      record.userMemoryIds = record.userMemoryIds.map((id: unknown) =>
        this.mapRelationValue({ field: 'userMemoryIds', sourceTable: 'userMemories' }, id),
      );
    }

    if (config.table === 'messages' && typeof record.targetId === 'string') {
      record.targetId = this.getIdMap('agents')[record.targetId] || record.targetId;
    }

    if ((config.table === 'agents' || config.table === 'sessions') && record.slug) {
      record.slug = `${String(record.slug).slice(0, 88)}-${Md5.hashStr(
        `${this.userId}:${config.table}:${String(source.id)}`,
      ).slice(0, 8)}`;
    }

    return record;
  }

  private async importSingleton(
    config: DataBackupTableConfig,
    source: Record<string, any>,
  ): Promise<ImportResult> {
    const result = EMPTY_RESULT();
    const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
    const existingRows = await this.getExistingRows(config);
    const record = this.prepareRecord(config, source);

    if (config.table === 'users') {
      const allowedUpdate: Record<string, unknown> = {};
      if ('isOnboarded' in source) allowedUpdate.isOnboarded = source.isOnboarded;
      if ('preference' in source) allowedUpdate.preference = source.preference;

      if (Object.keys(allowedUpdate).length > 0) {
        await (this.db as any)
          .update(table)
          .set(allowedUpdate)
          .where(eq(table.id, this.userId));
        result.updated = 1;
      }

      return result;
    }

    if (existingRows.length > 0) {
      await (this.db as any)
        .update(table)
        .set(record)
        .where(eq(table.id, this.userId));
      result.updated = 1;
    } else {
      await (this.db as any).insert(table).values(record);
      result.added = 1;
    }

    return result;
  }

  private async importGenerated(
    config: DataBackupTableConfig,
    tableData: Record<string, any>[],
  ): Promise<ImportResult> {
    const result = EMPTY_RESULT();
    const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
    const existingRows = await this.getExistingRows(config);
    const idMap = this.getIdMap(config.table);
    const sourceRows =
      config.table === 'messages'
        ? sortMessagesParentFirst(tableData, (message) => ({
            createdAt: message.createdAt,
            id: message.id,
            parentId: message.parentId,
          }))
        : tableData;
    const recordsToInsert: {
      record: Record<string, any>;
      source: Record<string, any>;
      stableId: string;
    }[] = [];

    for (const source of sourceRows) {
      if (typeof source.id !== 'string' || !source.id) {
        throw new Error(`Backup table ${config.table} contains a record without an ID`);
      }

      const stableId = this.createStableImportedId(config.table, source.id);
      const existing = this.findExistingGeneratedRecord(existingRows, source, stableId);

      if (existing) {
        idMap[source.id] = existing.id;
        if (source.clientId) idMap[source.clientId] = existing.id;
        result.skips++;
        continue;
      }

      const record = this.prepareRecord(config, source, stableId);
      recordsToInsert.push({ record, source, stableId });
    }

    const batchSize = 100;
    for (let index = 0; index < recordsToInsert.length; index += batchSize) {
      const batch = recordsToInsert.slice(index, index + batchSize);
      await (this.db as any)
        .insert(table)
        .values(batch.map(({ record }) => record));

      for (const { record, source, stableId } of batch) {
        existingRows.push(record);
        idMap[source.id] = stableId;
        if (source.clientId) idMap[source.clientId] = stableId;
        result.added++;

        if (config.relations?.some(({ deferred }) => deferred)) {
          this.deferredRecords.push({ config, source, targetId: stableId });
        }
      }
    }

    return result;
  }

  private async importNaturalOrJunction(
    config: DataBackupTableConfig,
    tableData: Record<string, any>[],
  ): Promise<ImportResult> {
    const result = EMPTY_RESULT();
    const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
    const existingRows = await this.getExistingRows(config);
    const conflictFields = config.conflictFields || [];

    for (const source of tableData) {
      const record = this.prepareRecord(config, source);
      const existing = this.findExistingConflict(existingRows, conflictFields, record);

      if (existing) {
        if (config.idStrategy === 'natural' && source.id) {
          this.getIdMap(config.table)[source.id] = existing.id;
        }
        result.skips++;
        continue;
      }

      const [inserted] = await (this.db as any).insert(table).values(record).returning();
      existingRows.push(inserted || record);
      result.added++;

      if (config.idStrategy === 'natural' && source.id) {
        this.getIdMap(config.table)[source.id] = inserted?.id || record.id;
      }
    }

    return result;
  }

  private async importTable(
    config: DataBackupTableConfig,
    tableData: Record<string, any>[],
  ): Promise<ImportResult> {
    if (config.idStrategy === 'singleton') {
      return this.importSingleton(config, tableData[0]);
    }

    if (config.idStrategy === 'generated') {
      return this.importGenerated(config, tableData);
    }

    return this.importNaturalOrJunction(config, tableData);
  }

  private async restoreDeferredRelationships() {
    for (const { config, source, targetId } of this.deferredRecords) {
      const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
      const updates: Record<string, unknown> = {};

      for (const relation of config.relations?.filter(({ deferred }) => deferred) || []) {
        if (!(relation.field in source)) continue;
        const sourceValue = source[relation.field];
        if (sourceValue === null || sourceValue === undefined) {
          updates[relation.field] = sourceValue;
          continue;
        }

        const mappedValue = this.getIdMap(relation.sourceTable)[String(sourceValue)];
        if (!mappedValue) {
          if (config.table === 'threads' && relation.field === 'sourceMessageId') {
            throw new Error(
              `Backup relationship is incomplete: messages.${String(sourceValue)} is missing`,
            );
          }

          // Older backups can contain dangling optional message/thread parent
          // pointers. Preserve importability while never pointing at another
          // user's record.
          updates[relation.field] = null;
          continue;
        }

        updates[relation.field] = mappedValue;
      }

      if (Object.keys(updates).length === 0) continue;

      const conditions = [eq(table.id, targetId)];
      if ('userId' in table) conditions.push(eq(table.userId, this.userId));

      await (this.db as any)
        .update(table)
        .set(updates)
        .where(and(...conditions));
    }
  }
}
