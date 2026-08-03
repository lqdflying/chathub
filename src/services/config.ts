import { BRANDING_NAME } from '@lobechat/const';
import { exportJSONFile } from '@lobechat/utils/client';
import dayjs from 'dayjs';

import { CURRENT_DATA_BACKUP_FORMAT_VERSION } from '@/types/export';

import { exportService } from './export';

class ConfigService {
  exportAll = async () => {
    const backup = await exportService.exportData();
    const filename = `${dayjs().format(
      'YYYY-MM-DD-HH-mm',
    )}_${BRANDING_NAME}-data-v${CURRENT_DATA_BACKUP_FORMAT_VERSION}.json`;

    exportJSONFile(backup, filename);
  };

}

export const configService = new ConfigService();
