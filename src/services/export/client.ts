import { CURRENT_VERSION } from '@lobechat/const';

import { clientDB } from '@/database/client/db';
import { DataExporterRepos } from '@/database/repositories/dataExporter';
import { BaseClientService } from '@/services/baseClientService';
import {
  CURRENT_DATA_BACKUP_FORMAT_VERSION,
  ExportDatabaseData,
  dataBackupV2Schema,
} from '@/types/export';

export class ClientService extends BaseClientService {
  private get dataExporterRepos(): DataExporterRepos {
    return new DataExporterRepos(clientDB as any, this.userId);
  }

  exportData = async (): Promise<ExportDatabaseData> => {
    const data = await this.dataExporterRepos.export();
    const { default: migrations } = await import('@/database/core/migrations.json');
    const schemaHash = migrations.at(-1)?.hash;
    if (!schemaHash) throw new Error('Database migration hash is unavailable');

    return dataBackupV2Schema.parse({
      appVersion: CURRENT_VERSION,
      data,
      exportedAt: new Date().toISOString(),
      formatVersion: CURRENT_DATA_BACKUP_FORMAT_VERSION,
      mode: 'pglite',
      schemaHash,
      secretStrategy: 'deployment-keyed',
    });
  };
}
