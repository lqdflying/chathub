import { t } from 'i18next';

import migrations from '@/database/core/migrations.json';
import { notification } from '@/components/AntdStaticMethods';
import { ImportPgDataStructure, parseDatabaseBackup } from '@/types/export';
import { ConfigFile } from '@/types/exportConfig';

export type ParsedImportFile = ConfigFile | ImportPgDataStructure;

const isLegacyConfigFile = (value: unknown): value is ConfigFile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const candidate = value as Partial<ConfigFile>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.exportType === 'string' &&
    !!candidate.state &&
    typeof candidate.state === 'object'
  );
};

const validateKnownSchema = (backup: ImportPgDataStructure) => {
  const hashes = migrations.map(({ hash }) => hash);
  const sourceIndex = hashes.indexOf(backup.schemaHash);
  const targetIndex = hashes.length - 1;

  if (sourceIndex < 0) throw new Error('The backup uses an unknown database schema.');
  if (sourceIndex > targetIndex) {
    throw new Error('The backup was created by a newer ChatHub version.');
  }
};

export const parseConfigFile = async (file: File): Promise<ParsedImportFile | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await file.text());

    const looksLikeDatabaseBackup =
      !!parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('schemaHash' in parsed || 'formatVersion' in parsed);

    if (!looksLikeDatabaseBackup && isLegacyConfigFile(parsed)) return parsed;

    const { backup } = parseDatabaseBackup(parsed);
    validateKnownSchema(backup);
    return backup;
  } catch (error) {
    console.error(error);
    notification.error({
      description: t('import.importConfigFile.description', {
        ns: 'error',
        reason: error instanceof Error ? error.message : String(error),
      }),
      message: t('import.importConfigFile.title', { ns: 'error' }),
    });
  }
};
