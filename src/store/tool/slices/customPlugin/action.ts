import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { t } from 'i18next';
import { cloneDeep, isEqual, merge } from 'lodash-es';
import { StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import {
  acquirePluginInstallLoading,
  captureToolMutationCheckpoint,
  isToolMutationCurrent,
  releasePluginInstallLoading,
  ToolMutationCheckpoint,
} from '@/store/tool/mutation';
import { pluginHelpers } from '@/store/tool/helpers';
import { LobeToolCustomPlugin, PluginInstallError } from '@/types/tool/plugin';
import { setNamespace } from '@/utils/storeDebug';

import { ToolStore } from '../../store';
import { pluginSelectors } from '../plugin/selectors';
import { defaultCustomPlugin } from './initialState';

const n = setNamespace('customPlugin');

const customPluginReinstallOperations = new Map<string, symbol>();

export interface CustomPluginAction {
  installCustomPlugin: (value: LobeToolCustomPlugin) => Promise<void>;
  reinstallCustomPlugin: (
    id: string,
    pluginOverride?: LobeToolCustomPlugin,
    checkpoint?: ToolMutationCheckpoint,
  ) => Promise<void>;
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
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    const submittedDraft = cloneDeep(value);
    const submittedDraftRevision = get().newCustomPluginRevision;

    await pluginService.createCustomPlugin(value);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    if (
      get().newCustomPluginRevision !== submittedDraftRevision ||
      !isEqual(get().newCustomPlugin, submittedDraft)
    )
      return;

    set(
      {
        newCustomPlugin: defaultCustomPlugin,
        newCustomPluginRevision: submittedDraftRevision + 1,
      },
      false,
      n('saveToCustomPluginList'),
    );
  },
  reinstallCustomPlugin: async (id, pluginOverride, originatingCheckpoint) => {
    const checkpoint =
      originatingCheckpoint || captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const plugin = pluginOverride || pluginSelectors.getCustomPluginById(id)(get());
    if (!plugin) return;

    const { refreshPlugins, updateInstallLoadingState } = get();
    const pluginId = plugin.identifier;
    const loadingOperation = acquirePluginInstallLoading(
      checkpoint,
      pluginId,
      updateInstallLoadingState,
    );
    customPluginReinstallOperations.set(loadingOperation.operationKey, loadingOperation.token);
    const isOperationCurrent = () =>
      customPluginReinstallOperations.get(loadingOperation.operationKey) ===
        loadingOperation.token &&
      isToolMutationCurrent(checkpoint, get().scopeGeneration);

    try {
      if (!isOperationCurrent()) return;
      let manifest: LobeChatPluginManifest;
      // mean this is a mcp plugin
      if (!!plugin.customParams?.mcp) {
        const mcp = plugin.customParams.mcp;
        if ((mcp as { type?: string }).type !== 'http') {
          notification.error({
            description: 'Replace this plugin with an HTTP MCP endpoint or remove it.',
            message: 'Unsupported MCP transport',
          });
          return;
        }
        const url = mcp.url;
        if (!url) return;

        if (!isOperationCurrent()) return;
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
      } else {
        if (!isOperationCurrent()) return;
        manifest = await toolService.getToolManifest(
          plugin.customParams?.manifestUrl,
          plugin.customParams?.useProxy,
        );
        if (!isOperationCurrent()) return;
      }

      if (!isOperationCurrent()) return;
      await pluginService.updatePluginManifest(pluginId, manifest);
      if (!isOperationCurrent()) return;

      await refreshPlugins(checkpoint);
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
      releasePluginInstallLoading(
        loadingOperation,
        get().scopeGeneration,
        updateInstallLoadingState,
      );
      if (
        customPluginReinstallOperations.get(loadingOperation.operationKey) ===
        loadingOperation.token
      ) {
        customPluginReinstallOperations.delete(loadingOperation.operationKey);
      }
    }
  },
  uninstallCustomPlugin: async (id) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await pluginService.uninstallPlugin(id);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
  },

  updateCustomPlugin: async (id, value) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const { reinstallCustomPlugin } = get();
    // 1. 更新 list 项信息
    await pluginService.updatePlugin(id, value);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    // 2. 重新安装插件
    await reinstallCustomPlugin(id, value, checkpoint);
  },
  updateNewCustomPlugin: (newCustomPlugin) => {
    set(
      {
        newCustomPlugin: merge({}, get().newCustomPlugin, newCustomPlugin),
        newCustomPluginRevision: get().newCustomPluginRevision + 1,
      },
      false,
      n('updateNewDevPlugin'),
    );
  },
});
