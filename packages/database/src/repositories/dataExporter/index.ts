import { asc, eq, getTableColumns } from 'drizzle-orm';

import { DataBackupRecords, DataBackupTable } from '@/types/export';

import { LobeChatDatabase } from '../../type';
import {
  DATA_BACKUP_REGISTRY,
  DATA_BACKUP_TABLE_OBJECTS,
} from '../dataBackupRegistry';

// Kept as a compatibility export for existing callers and tests. The shared
// registry is now the single source of truth for both directions.
export const DATA_EXPORT_CONFIG = {
  baseTables: DATA_BACKUP_REGISTRY,
  relationTables: [],
};

export class DataExporterRepos {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private sanitizeRows(rows: Record<string, any>[], table: DataBackupTable) {
    return rows.map((row) => {
      if (table === 'users') {
        return {
          isOnboarded: row.isOnboarded,
          preference: row.preference,
        };
      }

      const backupRow = { ...row };
      delete backupRow.userId;
      if (table === 'userSettings') delete backupRow.id;

      // messageOrder is a server sequence (and a bigint, which JSON cannot
      // serialize). Restore allocates a fresh deterministic parent-first order.
      if (table === 'messages') delete backupRow.messageOrder;

      return backupRow;
    });
  }

  private async exportFromDatabase(database: any): Promise<DataBackupRecords> {
    const result: DataBackupRecords = {};

    for (const config of DATA_BACKUP_REGISTRY) {
      const table = DATA_BACKUP_TABLE_OBJECTS[config.table] as any;
      if (!table) throw new Error(`Backup table ${config.table} is not available`);

      const columns = getTableColumns(table) as Record<string, any>;
      const orderBy = [];

      if (config.table === 'messages' && columns.messageOrder) {
        if (columns.createdAt) orderBy.push(asc(columns.createdAt));
        orderBy.push(asc(columns.messageOrder));
      } else {
        if (columns.createdAt) orderBy.push(asc(columns.createdAt));
        if (columns.id) orderBy.push(asc(columns.id));
      }

      const rows = await database
        .select()
        .from(table)
        .where(eq(table[config.userField], this.userId))
        .orderBy(...orderBy);

      result[config.table] = this.sanitizeRows(rows, config.table);
    }

    return result;
  }

  async export(concurrency = 10): Promise<DataBackupRecords> {
    void concurrency;
    return this.db.transaction(
      async (transaction) => this.exportFromDatabase(transaction),
      {
        accessMode: 'read only',
        isolationLevel: 'repeatable read',
      },
    );
  }
}
