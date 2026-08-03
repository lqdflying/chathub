import { createHeaderWithAuth } from '@/services/_auth';
import { parseDatabaseBackup } from '@/types/export';

import { IExportService } from './type';

export class ServerService implements IExportService {
  exportData: IExportService['exportData'] = async () => {
    const headers = await createHeaderWithAuth();
    const response = await fetch('/webapi/data/export', {
      cache: 'no-store',
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => undefined);
      throw new Error(error?.message || `Data export failed (${response.status})`);
    }

    const parsed = parseDatabaseBackup(await response.json());
    if (parsed.format !== 'v2') throw new Error('Server returned an outdated backup format');
    const mode = parsed.backup.mode;
    if (mode !== 'postgres') {
      throw new Error('Server returned a non-postgres backup');
    }

    return { ...parsed.backup, mode };
  };
}
