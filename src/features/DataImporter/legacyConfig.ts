import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';
import { Migration } from '@/migrations';
import { ConfigFile } from '@/types/exportConfig';

export const importLegacyConfigFile = async (
  file: File,
  onConfigImport: (config: ConfigFile) => Promise<void>,
) => {
  const text = await file.text();

  try {
    const config = JSON.parse(text);

    if ('schemaHash' in config) {
      notification.error({
        description: t('import.incompatible.description', { ns: 'error' }),
        message: t('import.incompatible.title', { ns: 'error' }),
      });
      return;
    }

    const { state, version } = Migration.migrate(config);

    await onConfigImport({ ...config, state, version });
  } catch (error) {
    console.error(error);
    notification.error({
      description: t('import.importConfigFile.description', {
        ns: 'error',
        reason: (error as Error).message,
      }),
      message: t('import.importConfigFile.title', { ns: 'error' }),
    });
  }
};
