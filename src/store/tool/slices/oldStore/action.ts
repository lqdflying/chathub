import { LobeTool } from '@lobechat/types';
import { t } from 'i18next';
import { produce } from 'immer';
import { uniqBy } from 'lodash-es';
import useSWR, { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { notification } from '@/components/AntdStaticMethods';
import { mutateAccountSWR, useClientDataSWR } from '@/libs/swr';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import {
  acquirePluginInstallLoading,
  captureToolMutationCheckpoint,
  isToolMutationCurrent,
  releasePluginInstallLoading,
  ToolMutationCheckpoint,
} from '@/store/tool/mutation';
import { globalHelpers } from '@/store/global/helpers';
import { pluginStoreSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { DiscoverPluginItem, PluginListResponse, PluginQueryParams } from '@/types/discover';
import { PluginInstallError } from '@/types/tool/plugin';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { ToolStore } from '../../store';
import { PluginInstallProgress, PluginInstallStep, PluginStoreState } from './initialState';

const n = setNamespace('pluginStore');

const INSTALLED_PLUGINS = 'loadInstalledPlugins';

const pluginInstallOperations = new Map<string, symbol>();

export interface PluginStoreAction {
  installOldPlugin: (
    identifier: string,
    source?: 'plugin' | 'customPlugin',
    checkpoint?: ToolMutationCheckpoint,
  ) => Promise<void>;
  installPlugin: (
    identifier: string,
    source?: 'plugin' | 'customPlugin',
    checkpoint?: ToolMutationCheckpoint,
  ) => Promise<void>;
  installPlugins: (plugins: string[], checkpoint?: ToolMutationCheckpoint) => Promise<void>;
  loadMorePlugins: () => void;
  loadPluginStore: (checkpoint?: ToolMutationCheckpoint) => Promise<DiscoverPluginItem[]>;
  refreshPlugins: (checkpoint?: ToolMutationCheckpoint) => Promise<void>;

  resetPluginList: (keywords?: string) => void;
  uninstallPlugin: (identifier: string) => Promise<void>;
  updateInstallLoadingState: (key: string, value: boolean | undefined) => void;
  updatePluginInstallProgress: (
    identifier: string,
    progress: PluginInstallProgress | undefined,
  ) => void;

  useFetchInstalledPlugins: (enabled: boolean) => SWRResponse<LobeTool[]>;
  useFetchPluginList: (params: PluginQueryParams) => SWRResponse<PluginListResponse>;
  useFetchPluginStore: () => SWRResponse<DiscoverPluginItem[]>;
}

export const createPluginStoreSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  PluginStoreAction
> = (set, get) => ({
  installOldPlugin: async (name, type = 'plugin', originatingCheckpoint) => {
    const checkpoint =
      originatingCheckpoint || captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const plugin = pluginStoreSelectors.getPluginById(name)(get());
    if (!plugin) return;

    const { updateInstallLoadingState, refreshPlugins, updatePluginInstallProgress } = get();
    const loadingOperation = acquirePluginInstallLoading(
      checkpoint,
      name,
      updateInstallLoadingState,
    );
    pluginInstallOperations.set(loadingOperation.operationKey, loadingOperation.token);
    const isOperationCurrent = () =>
      pluginInstallOperations.get(loadingOperation.operationKey) === loadingOperation.token &&
      isToolMutationCurrent(checkpoint, get().scopeGeneration);

    try {
      if (!isOperationCurrent()) return;
      updatePluginInstallProgress(name, {
        progress: 25,
        step: PluginInstallStep.FETCHING_MANIFEST,
      });

      const data = await toolService.getToolManifest(plugin.manifest);
      if (!isOperationCurrent()) return;

      updatePluginInstallProgress(name, {
        progress: 60,
        step: PluginInstallStep.INSTALLING_PLUGIN,
      });

      await pluginService.installPlugin({ identifier: plugin.identifier, manifest: data, type });
      if (!isOperationCurrent()) return;

      updatePluginInstallProgress(name, {
        progress: 85,
        step: PluginInstallStep.INSTALLING_PLUGIN,
      });

      await refreshPlugins(checkpoint);
      if (!isOperationCurrent()) return;

      updatePluginInstallProgress(name, {
        progress: 100,
        step: PluginInstallStep.COMPLETED,
      });

      await sleep(1000);
      if (!isOperationCurrent()) return;

      updatePluginInstallProgress(name, undefined);
    } catch (error) {
      if (!isOperationCurrent()) return;

      console.error(error);

      const err = error as PluginInstallError;

      updatePluginInstallProgress(name, {
        error: err.message,
        progress: 0,
        step: PluginInstallStep.ERROR,
      });

      notification.error({
        description: t(`error.${err.message}`, { ns: 'plugin' }),
        message: t('error.installError', { name: plugin.title, ns: 'plugin' }),
      });
    } finally {
      releasePluginInstallLoading(
        loadingOperation,
        get().scopeGeneration,
        updateInstallLoadingState,
      );
      if (
        pluginInstallOperations.get(loadingOperation.operationKey) === loadingOperation.token
      ) {
        pluginInstallOperations.delete(loadingOperation.operationKey);
      }
    }
  },
  installPlugin: async (name, type = 'plugin', originatingCheckpoint) => {
    const checkpoint =
      originatingCheckpoint || captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const plugin = pluginStoreSelectors.getPluginById(name)(get());
    if (!plugin) return;

    const { updateInstallLoadingState, refreshPlugins } = get();
    const loadingOperation = acquirePluginInstallLoading(
      checkpoint,
      name,
      updateInstallLoadingState,
    );
    pluginInstallOperations.set(loadingOperation.operationKey, loadingOperation.token);
    const isOperationCurrent = () =>
      pluginInstallOperations.get(loadingOperation.operationKey) === loadingOperation.token &&
      isToolMutationCurrent(checkpoint, get().scopeGeneration);

    try {
      if (!isOperationCurrent()) return;
      const data = await toolService.getToolManifest(plugin.manifest);
      if (!isOperationCurrent()) return;

      await pluginService.installPlugin({ identifier: plugin.identifier, manifest: data, type });
      if (!isOperationCurrent()) return;

      await refreshPlugins(checkpoint);
      if (!isOperationCurrent()) return;
    } catch (error) {
      if (!isOperationCurrent()) return;

      console.error(error);

      const err = error as PluginInstallError;

      notification.error({
        description: t(`error.${err.message}`, { ns: 'plugin' }),
        message: t('error.installError', { name: plugin.title, ns: 'plugin' }),
      });
    } finally {
      releasePluginInstallLoading(
        loadingOperation,
        get().scopeGeneration,
        updateInstallLoadingState,
      );
      if (
        pluginInstallOperations.get(loadingOperation.operationKey) === loadingOperation.token
      ) {
        pluginInstallOperations.delete(loadingOperation.operationKey);
      }
    }
  },
  installPlugins: async (plugins, originatingCheckpoint) => {
    const checkpoint =
      originatingCheckpoint || captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const { installPlugin } = get();

    await Promise.all(
      plugins.map((identifier) => installPlugin(identifier, 'plugin', checkpoint)),
    );
  },
  loadMorePlugins: () => {
    const { oldPluginItems, pluginTotalCount, currentPluginPage } = get();

    // 检查是否还有更多数据可以加载
    if (oldPluginItems.length < (pluginTotalCount || 0)) {
      set(
        produce((draft: PluginStoreState) => {
          draft.currentPluginPage = currentPluginPage + 1;
        }),
        false,
        n('loadMorePlugins'),
      );
    }
  },
  loadPluginStore: async (originatingCheckpoint) => {
    if (
      originatingCheckpoint &&
      !isToolMutationCurrent(originatingCheckpoint, get().scopeGeneration)
    ) {
      return [];
    }
    const requestedScopeGeneration = get().scopeGeneration;

    const locale = globalHelpers.getCurrentLanguage();

    if (
      originatingCheckpoint &&
      !isToolMutationCurrent(originatingCheckpoint, get().scopeGeneration)
    ) {
      return [];
    }
    const data = await toolService.getOldPluginList({
      locale,
      page: 1,
      pageSize: 50,
    });

    if (requestedScopeGeneration !== get().scopeGeneration) return data.items;
    if (
      originatingCheckpoint &&
      !isToolMutationCurrent(originatingCheckpoint, get().scopeGeneration)
    ) {
      return data.items;
    }
    set({ oldPluginItems: data.items }, false, n('loadPluginList'));

    return data.items;
  },
  refreshPlugins: async (originatingCheckpoint) => {
    const checkpoint =
      originatingCheckpoint ?? captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await mutateAccountSWR([
      INSTALLED_PLUGINS,
      checkpoint.accountMutationSnapshot.scope,
    ]);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
  },
  resetPluginList: (keywords) => {
    set(
      produce((draft: PluginStoreState) => {
        draft.oldPluginItems = [];
        draft.currentPluginPage = 1;
        draft.pluginSearchKeywords = keywords;
      }),
      false,
      n('resetPluginList'),
    );
  },
  uninstallPlugin: async (identifier) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await pluginService.uninstallPlugin(identifier);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
  },
  updateInstallLoadingState: (key, value) => {
    set(
      produce((draft: PluginStoreState) => {
        draft.pluginInstallLoading[key] = value;
      }),
      false,
      n('updateInstallLoadingState'),
    );
  },
  updatePluginInstallProgress: (identifier, progress) => {
    set(
      produce((draft: PluginStoreState) => {
        draft.pluginInstallProgress[identifier] = progress;
      }),
      false,
      n(`updatePluginInstallProgress/${progress?.step || 'clear'}`),
    );
  },

  useFetchInstalledPlugins: (enabled: boolean) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR<LobeTool[]>(
      enabled && requestedScope ? [INSTALLED_PLUGINS, requestedScope] : null,
      pluginService.getInstalledPlugins,
      {
        fallbackData: [],
        onSuccess: (data) => {
          if (authSelectors.currentUserScope(useUserStore.getState()) !== requestedScope) return;

          set(
            { installedPlugins: data, loadingInstallPlugins: false },
            false,
            n('useFetchInstalledPlugins'),
          );
        },
        revalidateOnFocus: false,
        suspense: true,
      },
    );
  },
  useFetchPluginList: (params) => {
    const locale = globalHelpers.getCurrentLanguage();

    return useSWR<PluginListResponse>(
      ['useFetchPluginList', locale, ...Object.values(params)].filter(Boolean).join('-'),
      async () => toolService.getOldPluginList(params),
      {
        onSuccess(data) {
          set(
            produce((draft: PluginStoreState) => {
              draft.pluginSearchLoading = false;

              // 设置基础信息
              if (!draft.isPluginListInit) {
                draft.activePluginIdentifier = data.items?.[0]?.identifier;
                draft.isPluginListInit = true;
                draft.pluginTotalCount = data.totalCount;
              }

              // 累积数据逻辑
              if (params.page === 1) {
                // 第一页，直接设置
                draft.oldPluginItems = uniqBy(data.items, 'identifier');
              } else {
                // 后续页面，累积数据
                draft.oldPluginItems = uniqBy(
                  [...draft.oldPluginItems, ...data.items],
                  'identifier',
                );
              }
            }),
            false,
            n('useFetchPluginList/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
  useFetchPluginStore: () =>
    useSWR<DiscoverPluginItem[]>('loadPluginStore', () => get().loadPluginStore(), {
      revalidateOnFocus: false,
    }),
});
