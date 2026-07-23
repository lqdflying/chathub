import { BRANDING_NAME, isDeprecatedEdition } from '@lobechat/const';
import { exportJSONFile } from '@lobechat/utils/client';
import dayjs from 'dayjs';

import { CURRENT_CONFIG_VERSION } from '@/migrations';
import { CURRENT_DATA_BACKUP_FORMAT_VERSION } from '@/types/export';

import { exportService } from './export';
import { configService as deprecatedExportService } from './export/_deprecated';

class ConfigService {
  exportAll = async () => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const config = await deprecatedExportService.exportAll();
      const filename = `${BRANDING_NAME}-config-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(config, filename);
      return;
    }

    const backup = await exportService.exportData();
    const filename = `${dayjs().format(
      'YYYY-MM-DD-HH-mm',
    )}_${BRANDING_NAME}-data-v${CURRENT_DATA_BACKUP_FORMAT_VERSION}.json`;

    exportJSONFile(backup, filename);
  };

  exportAgents = async () => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const config = await deprecatedExportService.exportAgents();
      const filename = `${BRANDING_NAME}-agents-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(config, filename);
      return;
    }
  };

  exportSingleAgent = async (agentId: string) => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const result = await deprecatedExportService.exportSingleAgent(agentId);
      if (!result) return;

      const filename = `${BRANDING_NAME}-${result.title}-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(result.config, filename);
      return;
    }
  };

  exportSessions = async () => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const config = await deprecatedExportService.exportSessions();
      const filename = `${BRANDING_NAME}-sessions-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(config, filename);
      return;
    }
  };

  exportSettings = async () => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const config = await deprecatedExportService.exportSettings();
      const filename = `${BRANDING_NAME}-settings-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(config, filename);
      return;
    }
  };

  exportSingleSession = async (sessionId: string) => {
    // TODO: remove this in V2
    if (isDeprecatedEdition) {
      const data = await deprecatedExportService.exportSingleSession(sessionId);
      if (!data) return;

      const filename = `${BRANDING_NAME}-${data.title}-v${CURRENT_CONFIG_VERSION}.json`;
      exportJSONFile(data.config, filename);
      return;
    }
  };
}

export const configService = new ConfigService();
