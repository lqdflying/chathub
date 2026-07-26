import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { t } from 'i18next';
import { merge } from 'lodash-es';
import { StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { LobeToolCustomPlugin, PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { ToolStore } from '../../store';
import { pluginSelectors } from '../plugin/selectors';
import { defaultCustomPlugin } from './initialState';

const n = setNamespace('customPlugin');

export interface CustomPluginAction {
  installCustomPlugin: (value: LobeToolCustomPlugin) => Promise<void>;
  reinstallCustomPlugin: (id: string, pluginOverride?: LobeToolCustomPlugin) => Promise<void>;
  uninstallCustomPlugin: (id: string) => Promise<void>;
  updateCustomPlugin: (id: string, value: LobeToolCustomPlugin) => Promise<void>;
  updateNewCustomPlugin: (value: Partial<LobeToolCustomPlugin>) => void;
}

export const createCustomPluginSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  CustomPluginAction
> = (set, get) => ({
  installCustomPlugin: async (value) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await pluginService.createCustomPlugin(value);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshPlugins();
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    set({ newCustomPlugin: defaultCustomPlugin }, false, n('saveToCustomPluginList'));
  },
  reinstallCustomPlugin: async (id, pluginOverride) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;
    const isOperationCurrent = () =>
      authSelectors.currentUserScope(useUserStore.getState()) === requestedScope &&
      get().scopeGeneration === requestedGeneration;

    const plugin = pluginOverride || pluginSelectors.getCustomPluginById(id)(get());
    if (!plugin) return;

    const { refreshPlugins, updateInstallLoadingState } = get();
    const pluginId = plugin.identifier;

    try {
      updateInstallLoadingState(pluginId, true);
      let manifest: LobeChatPluginManifest;
      // mean this is a mcp plugin
      if (!!plugin.customParams?.mcp) {
        const mcp = plugin.customParams.mcp;
        if (mcp.type === 'stdio') {
          if (!mcp.command) return;

          manifest = await mcpService.getStdioMcpServerManifest(
            {
              args: mcp.args,
              command: mcp.command,
              env: mcp.env,
              name: pluginId,
            },
            {
              avatar: plugin.customParams.avatar,
              description: plugin.customParams.description,
            },
          );
          if (!isOperationCurrent()) return;
        } else {
          const url = mcp.url;
          if (!url) return;

          manifest = await mcpService.getStreamableMcpServerManifest({
            auth: mcp.auth,
            headers: mcp.headers,
            identifier: pluginId,
            metadata: {
              avatar: plugin.customParams.avatar,
              description: plugin.customParams.description,
            },
            url,
          });
          if (!isOperationCurrent()) return;
        }
      } else {
        manifest = await toolService.getToolManifest(
          plugin.customParams?.manifestUrl,
          plugin.customParams?.useProxy,
        );
        if (!isOperationCurrent()) return;
      }

      await pluginService.updatePluginManifest(pluginId, manifest);
      if (!isOperationCurrent()) return;

      await refreshPlugins();
    } catch (error) {
      if (!isOperationCurrent()) return;

      console.error(error);
      const err = error as PluginInstallError;

      const meta = pluginSelectors.getPluginMetaById(pluginId)(get());
      const name = pluginHelpers.getPluginTitle(meta);

      notification.error({
        description: t(`error.${err.message}`, { error: err.cause, ns: 'plugin' }),
        message: t('error.reinstallError', { name, ns: 'plugin' }),
      });
    } finally {
      if (isOperationCurrent()) updateInstallLoadingState(pluginId, false);
    }
  },
  uninstallCustomPlugin: async (id) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    await pluginService.uninstallPlugin(id);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    await get().refreshPlugins();
  },

  updateCustomPlugin: async (id, value) => {
    const requestedScope = authSelectors.currentUserScope(useUserStore.getState());
    const requestedGeneration = get().scopeGeneration;
    if (!requestedScope) return;

    const { reinstallCustomPlugin } = get();
    // 1. 更新 list 项信息
    await pluginService.updatePlugin(id, value);
    if (
      authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope ||
      get().scopeGeneration !== requestedGeneration
    )
      return;

    // 2. 重新安装插件
    await reinstallCustomPlugin(id, value);
  },
  updateNewCustomPlugin: (newCustomPlugin) => {
    set(
      { newCustomPlugin: merge({}, get().newCustomPlugin, newCustomPlugin) },
      false,
      n('updateNewDevPlugin'),
    );
  },
});
