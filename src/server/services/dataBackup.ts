import migrations from '@/database/core/migrations.json';
import { DrizzleMigrationModel } from '@/database/models/drizzleMigration';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  ImportPgDataStructure,
  ParsedDatabaseBackup,
  getIgnoredBackupTables,
  parseDatabaseBackup,
} from '@/types/export';

export type DataBackupErrorCode =
  | 'BACKUP_SECRET_MISMATCH'
  | 'INVALID_BACKUP'
  | 'SOURCE_SCHEMA_NEWER'
  | 'UNKNOWN_SCHEMA'
  | 'UNSUPPORTED_BACKUP_FORMAT';

export class DataBackupError extends Error {
  readonly code: DataBackupErrorCode;
  readonly status: number;

  constructor(code: DataBackupErrorCode, message: string, status = 422) {
    super(message);
    this.code = code;
    this.name = 'DataBackupError';
    this.status = status;
  }
}

const migrationHashes = migrations.map(({ hash }) => hash);

export const validateBackupSchemaCompatibility = (
  backup: ImportPgDataStructure,
  targetSchemaHash: string,
) => {
  const sourceIndex = migrationHashes.indexOf(backup.schemaHash);
  const targetIndex = migrationHashes.indexOf(targetSchemaHash);

  if (sourceIndex < 0 || targetIndex < 0) {
    throw new DataBackupError(
      'UNKNOWN_SCHEMA',
      'The backup or target database uses an unknown migration version.',
    );
  }

  if (sourceIndex > targetIndex) {
    throw new DataBackupError(
      'SOURCE_SCHEMA_NEWER',
      'This backup was created by a newer ChatHub database. Upgrade ChatHub before importing it.',
      409,
    );
  }
};

const getEncryptedVaultValues = (backup: ImportPgDataStructure): string[] => {
  const values = [
    ...(backup.data.userSettings || []).map((row) => row.keyVaults),
    ...(backup.data.aiProviders || []).map((row) => row.keyVaults),
  ];

  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
};

export const validateBackupSecrets = async (backup: ImportPgDataStructure) => {
  const encryptedValues = getEncryptedVaultValues(backup);
  if (encryptedValues.length === 0) return;

  try {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    for (const encryptedValue of encryptedValues) {
      const result = await gateKeeper.decrypt(encryptedValue);
      if (!result.wasAuthentic) throw new Error('Authentication failed');

      if (result.plaintext) JSON.parse(result.plaintext);
    }
  } catch {
    throw new DataBackupError(
      'BACKUP_SECRET_MISMATCH',
      'Encrypted credentials cannot be restored with the current KEY_VAULTS_SECRET.',
    );
  }
};

export const parseAndPreflightDatabaseBackup = async (
  input: unknown,
  database: LobeChatDatabase,
): Promise<ParsedDatabaseBackup & { ignoredTables: string[] }> => {
  let parsed: ParsedDatabaseBackup;

  try {
    parsed = parseDatabaseBackup(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid database backup';
    const code = message.startsWith('Unsupported backup format')
      ? 'UNSUPPORTED_BACKUP_FORMAT'
      : 'INVALID_BACKUP';
    throw new DataBackupError(code, message, 400);
  }

  const targetSchemaHash = await new DrizzleMigrationModel(database).getLatestMigrationHash();
  validateBackupSchemaCompatibility(parsed.backup, targetSchemaHash);
  await validateBackupSecrets(parsed.backup);

  return {
    ...parsed,
    ignoredTables: getIgnoredBackupTables(parsed.backup),
  };
};
