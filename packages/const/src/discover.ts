import { DiscoverPluginDetail } from '@lobechat/types';

const DEFAULT_CREATED_AT = new Date().toISOString();

export const DEFAULT_DISCOVER_PLUGIN_ITEM: Partial<DiscoverPluginDetail> = {
  author: '',
  createdAt: DEFAULT_CREATED_AT,
  homepage: '',
  identifier: '',
  schemaVersion: 1,
};
