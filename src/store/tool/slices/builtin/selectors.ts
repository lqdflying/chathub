import { LobeToolMeta } from '@lobechat/types';

import { DalleManifest } from '@/tools/dalle';

import type { ToolStoreState } from '../../initialState';

const metaList =
  (showDalle?: boolean) =>
  (s: ToolStoreState): LobeToolMeta[] =>
    s.builtinTools
      .filter((item) => {
        // Filter hidden tools
        if (item.hidden) return false;

        // Filter Dalle if not enabled
        if (!showDalle && item.identifier === DalleManifest.identifier) return false;

        return true;
      })
      .map((t) => ({
        author: 'ChatHub',
        identifier: t.identifier,
        meta: t.manifest.meta,
        type: 'builtin',
      }));

export const builtinToolSelectors = {
  metaList,
};
