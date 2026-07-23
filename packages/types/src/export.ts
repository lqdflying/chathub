import { z } from 'zod';

export const CURRENT_DATA_BACKUP_FORMAT_VERSION = 2 as const;

export const DATA_BACKUP_TABLES = [
  'users',
  'userSettings',
  'userInstalledPlugins',
  'aiProviders',
  'aiModels',
  'userMemories',
  'userMemoriesContexts',
  'userMemoriesPreferences',
  'userMemoriesIdentities',
  'userMemoriesExperiences',
  'sessionGroups',
  'agents',
  'sessions',
  'chatGroups',
  'topics',
  'threads',
  'messageGroups',
  'messages',
  'agentsToSessions',
  'chatGroupsAgents',
  'messagePlugins',
  'messageTranslates',
] as const;

export type DataBackupTable = (typeof DATA_BACKUP_TABLES)[number];
export type DataBackupMode = 'pglite' | 'postgres';
export type DataImportStrategy = 'merge' | 'replace';

export type DataBackupRecords = Partial<Record<DataBackupTable, Record<string, unknown>[]>>;

const backupRowSchema = z.record(z.string(), z.unknown());
const backupDataSchema = z.record(z.string(), z.array(backupRowSchema));

const supportedBackupDataSchema = backupDataSchema.superRefine((data, ctx) => {
  const supportedTables = new Set<string>(DATA_BACKUP_TABLES);

  for (const table of DATA_BACKUP_TABLES) {
    if (!(table in data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Backup is incomplete: missing table ${table}`,
        path: [table],
      });
    }
  }

  if (data.users?.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Backup must contain exactly one sanitized user state record',
      path: ['users'],
    });
  }

  if ((data.userSettings?.length || 0) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Backup contains multiple user settings records',
      path: ['userSettings'],
    });
  }

  for (const table of Object.keys(data)) {
    if (!supportedTables.has(table)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported backup table: ${table}`,
        path: [table],
      });
    }
  }
});

export const legacyDatabaseBackupSchema = z
  .object({
    data: backupDataSchema,
    mode: z.enum(['pglite', 'postgres']),
    schemaHash: z.string().min(1),
  })
  .passthrough();

export const dataBackupV2Schema = z
  .object({
    appVersion: z.string().min(1),
    data: supportedBackupDataSchema,
    exportedAt: z.string().datetime(),
    formatVersion: z.literal(CURRENT_DATA_BACKUP_FORMAT_VERSION),
    mode: z.enum(['pglite', 'postgres']),
    schemaHash: z.string().min(1),
    secretStrategy: z.literal('deployment-keyed'),
  })
  .strict();

export type LegacyDatabaseBackup = z.infer<typeof legacyDatabaseBackupSchema>;
export type DataBackupV2 = z.infer<typeof dataBackupV2Schema>;
export type ImportPgDataStructure = LegacyDatabaseBackup | DataBackupV2;
export type ExportDatabaseData = DataBackupV2;

export type ParsedDatabaseBackup =
  | { backup: DataBackupV2; format: 'v2' }
  | { backup: LegacyDatabaseBackup; format: 'v1' };

export const parseDatabaseBackup = (input: unknown): ParsedDatabaseBackup => {
  const v2Result = dataBackupV2Schema.safeParse(input);
  if (v2Result.success) return { backup: v2Result.data, format: 'v2' };

  const formatVersion =
    input && typeof input === 'object' && 'formatVersion' in input
      ? (input as { formatVersion?: unknown }).formatVersion
      : undefined;

  if (formatVersion !== undefined) {
    if (formatVersion !== CURRENT_DATA_BACKUP_FORMAT_VERSION) {
      throw new Error(`Unsupported backup format version: ${String(formatVersion)}`);
    }

    throw new Error(v2Result.error.issues[0]?.message || 'Invalid version 2 backup');
  }

  const legacyResult = legacyDatabaseBackupSchema.safeParse(input);
  if (legacyResult.success) return { backup: legacyResult.data, format: 'v1' };

  throw new Error(legacyResult.error.issues[0]?.message || 'Invalid database backup');
};

export const getIgnoredBackupTables = (backup: ImportPgDataStructure): string[] => {
  const supportedTables = new Set<string>(DATA_BACKUP_TABLES);

  return Object.entries(backup.data)
    .filter(([table, records]) => !supportedTables.has(table) && records.length > 0)
    .map(([table]) => table);
};
