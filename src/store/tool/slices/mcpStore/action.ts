import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { PluginItem, PluginListResponse } from '@lobehub/market-sdk';
import { TRPCClientError } from '@trpc/client';
import { produce } from 'immer';
import { uniqBy } from 'lodash-es';
import { gt, valid } from 'semver';
import useSWR, { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { CURRENT_VERSION } from '@/const/version';
import { MCPErrorData } from '@/libs/mcp/types';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { globalHelpers } from '@/store/global/helpers';
import {
  PluginInstallLoadingOperation,
  acquirePluginInstallLoading,
  captureToolMutationCheckpoint,
  isToolMutationCurrent,
  releasePluginInstallLoading,
} from '@/store/tool/mutation';
import { mcpStoreSelectors } from '@/store/tool/selectors';
import {
  MCPErrorInfo,
  MCPInstallProgress,
  MCPInstallStep,
  MCPPluginListParams,
  McpConnectionParams,
} from '@/types/plugins';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { ToolStore } from '../../store';
import { MCPStoreState } from './initialState';

const n = setNamespace('mcpStore');

// 测试连接结果类型
export interface TestMcpConnectionResult {
  error?: string;
  manifest?: LobeChatPluginManifest;
  success: boolean;
}

export interface PluginMCPStoreAction {
  cancelInstallMCPPlugin: (identifier: string) => Promise<void>;
  cancelMcpConnectionTest: (identifier: string) => void;
  installMCPPlugin: (
    identifier: string,
    options?: { config?: Record<string, any>; resume?: boolean },
  ) => Promise<boolean | undefined>;
  loadMoreMCPPlugins: () => void;
  resetMCPPluginList: (keywords?: string) => void;
  // 测试连接相关方法
  testMcpConnection: (params: McpConnectionParams) => Promise<TestMcpConnectionResult>;
  uninstallMCPPlugin: (identifier: string) => Promise<void>;
  updateMCPInstallProgress: (identifier: string, progress: MCPInstallProgress | undefined) => void;
  useFetchMCPPluginList: (params: MCPPluginListParams) => SWRResponse<PluginListResponse>;
}

export const createMCPPluginStoreSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  PluginMCPStoreAction
> = (set, get) => ({
  cancelInstallMCPPlugin: async (identifier) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    // 获取并取消AbortController
    const abortController = get().mcpInstallAbortControllers[identifier];
    if (abortController) {
      abortController.abort();

      // 清理AbortController存储
      set(
        produce((draft: MCPStoreState) => {
          delete draft.mcpInstallAbortControllers[identifier];
        }),
        false,
        n('cancelInstallMCPPlugin/clearController'),
      );
    }

    // 清理安装进度和加载状态
    get().updateMCPInstallProgress(identifier, undefined);
  },

  // 取消 MCP 连接测试
  cancelMcpConnectionTest: (identifier) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const abortController = get().mcpTestAbortControllers[identifier];
    if (abortController) {
      abortController.abort();

      // 清理状态
      set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          delete draft.mcpTestAbortControllers[identifier];
          delete draft.mcpTestErrors[identifier];
        }),
        false,
        n('cancelMcpConnectionTest'),
      );
    }
  },

  installMCPPlugin: async (identifier, options = {}) => {
    const { resume = false, config } = options;
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const previousAbortController = get().mcpInstallAbortControllers[identifier];
    previousAbortController?.abort();

    const abortController = new AbortController();
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    set(
      produce((draft: MCPStoreState) => {
        draft.mcpInstallAbortControllers[identifier] = abortController;
      }),
      false,
      n('installMCPPlugin/setController'),
    );

    const isOperationCurrent = () =>
      !abortController.signal.aborted &&
      isToolMutationCurrent(checkpoint, get().scopeGeneration) &&
      get().mcpInstallAbortControllers[identifier] === abortController;
    const clearAbortController = () => {
      if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
      if (get().mcpInstallAbortControllers[identifier] !== abortController) return;

      set(
        produce((draft: MCPStoreState) => {
          delete draft.mcpInstallAbortControllers[identifier];
        }),
        false,
        n('installMCPPlugin/clearController'),
      );
    };
    const { updateInstallLoadingState, refreshPlugins, updateMCPInstallProgress } = get();
    let loadingOperation: PluginInstallLoadingOperation | undefined;
    const acquireLoadingOperation = () => {
      loadingOperation ||= acquirePluginInstallLoading(
        checkpoint,
        identifier,
        updateInstallLoadingState,
      );
    };
    const releaseLoadingOperation = () => {
      if (!loadingOperation) return;

      releasePluginInstallLoading(
        loadingOperation,
        get().scopeGeneration,
        updateInstallLoadingState,
      );
    };

    let plugin = mcpStoreSelectors.getPluginById(identifier)(get());

    if (!plugin || !plugin.manifestUrl) {
      let pluginDetail: unknown;
      try {
        if (!isOperationCurrent()) return;
        pluginDetail = await discoverService.getMcpDetail({ identifier });
      } catch (error) {
        const shouldHandleError = isOperationCurrent();
        clearAbortController();
        if (!shouldHandleError) return;
        throw error;
      }
      if (!isOperationCurrent()) {
        clearAbortController();
        return;
      }
      if (!pluginDetail) {
        clearAbortController();
        return;
      }

      plugin = pluginDetail as PluginItem;
    }

    if (!plugin) {
      clearAbortController();
      return;
    }

    // 记录安装开始时间
    const installStartTime = Date.now();

    let data: any;
    let connection: any;
    const userAgent = `ChatHub/${CURRENT_VERSION}`;

    try {
      // 检查是否已被取消
      if (!isOperationCurrent()) {
        return;
      }

      if (resume) {
        // 恢复模式：从存储中获取之前的信息
        const configInfo = get().mcpInstallProgress[identifier];
        if (!configInfo) {
          console.error('No config info found for resume');
          return;
        }

        data = configInfo.manifest;
        connection = {
          ...configInfo.connection,
          config, // 合并用户提供的配置
        };
      } else {
        // 正常模式：从头开始安装

        // 步骤 1: 获取插件清单
        if (!isOperationCurrent()) return;
        updateMCPInstallProgress(identifier, {
          progress: 15,
          step: MCPInstallStep.FETCHING_MANIFEST,
        });

        if (!isOperationCurrent()) return;
        acquireLoadingOperation();
        if (!isOperationCurrent()) return;
        data = await discoverService.getMCPPluginManifest(plugin.identifier, {
          install: true,
        });
        if (!isOperationCurrent()) return;

        const httpDeployments = (data.deploymentOptions || []).filter(
          (option: any) => option.connection?.type === 'http' && option.connection.url,
        );
        const deployment =
          httpDeployments.find((option: any) => option.isRecommended) || httpDeployments[0];
        if (!deployment) {
          throw new Error('This marketplace entry does not provide an HTTP MCP endpoint.');
        }

        connection = { ...deployment.connection, type: 'http' };

        if (connection.configSchema) {
          if (!isOperationCurrent()) return;
          updateMCPInstallProgress(identifier, {
            configSchema: connection.configSchema,
            connection,
            manifest: data,
            needsConfig: true,
            progress: 50,
            step: MCPInstallStep.CONFIGURATION_REQUIRED,
          });

          if (!isOperationCurrent()) return;
          return false;
        }
      }

      // 获取服务器清单逻辑
      if (!isOperationCurrent()) return;
      acquireLoadingOperation();

      // 步骤 5: 获取服务器清单
      if (!isOperationCurrent()) return;
      updateMCPInstallProgress(identifier, {
        progress: 70,
        step: MCPInstallStep.GETTING_SERVER_MANIFEST,
      });

      let manifest: LobeChatPluginManifest | undefined;

      if (!connection?.url) throw new Error('The HTTP MCP endpoint is missing a URL.');
      if (!isOperationCurrent()) return;
      manifest = await mcpService.getStreamableMcpServerManifest(
        {
          identifier,
          metadata: {
            avatar: plugin.icon,
            description: plugin.description,
          },
          url: connection.url,
        },
        abortController.signal,
      );
      if (!isOperationCurrent()) return;

      // set version
      if (manifest) {
        // set Version - 使用 semver 比较版本号并取更大的值
        const dataVersion = data?.version;
        const manifestVersion = manifest.version;

        if (dataVersion && manifestVersion) {
          // 如果两个版本都存在，比较并取更大的值
          if (valid(dataVersion) && valid(manifestVersion)) {
            manifest.version = gt(dataVersion, manifestVersion) ? dataVersion : manifestVersion;
          } else {
            // 如果版本号格式不正确，优先使用 dataVersion
            manifest.version = dataVersion;
          }
        } else {
          // 如果只有一个版本存在，使用存在的版本
          manifest.version = dataVersion || manifestVersion;
        }
      }

      if (!isOperationCurrent()) return;

      if (!manifest) {
        if (!isOperationCurrent()) return;
        updateMCPInstallProgress(identifier, undefined);
        return;
      }

      // 步骤 6: 安装插件
      if (!isOperationCurrent()) return;
      updateMCPInstallProgress(identifier, {
        progress: 90,
        step: MCPInstallStep.INSTALLING_PLUGIN,
      });

      if (!isOperationCurrent()) return;
      await pluginService.installPlugin({
        // 针对 mcp 先将 connection 信息存到 customParams 字段里
        customParams: { mcp: connection },
        identifier: plugin.identifier,
        manifest: manifest,
        settings: config,
        type: 'plugin',
      });

      // 检查是否已被取消
      if (!isOperationCurrent()) {
        return;
      }

      await refreshPlugins(checkpoint);
      if (!isOperationCurrent()) return;

      // 步骤 7: 完成安装
      if (!isOperationCurrent()) return;
      updateMCPInstallProgress(identifier, {
        progress: 100,
        step: MCPInstallStep.COMPLETED,
      });

      // 计算安装持续时间
      const installDurationMs = Date.now() - installStartTime;

      if (!isOperationCurrent()) return;
      try {
        await discoverService.reportMcpInstallResult(
          {
            identifier: plugin.identifier,
            installDurationMs,
            installParams: connection,
            manifest: {
              prompts: (manifest as any).prompts,
              resources: (manifest as any).resources,
              tools: (manifest as any).tools,
            },
            platform: 'web',
            success: true,
            userAgent,
            version: manifest.version || data.version,
          },
          {
            isCurrent: isOperationCurrent,
            signal: abortController.signal,
          },
        );
      } catch (reportError) {
        console.warn('Failed to report successful MCP installation:', reportError);
      }
      if (!isOperationCurrent()) return;

      // 短暂显示完成状态后清除进度
      await sleep(1000);
      if (!isOperationCurrent()) return;

      updateMCPInstallProgress(identifier, undefined);

      return true;
    } catch (e) {
      // 如果是因为取消导致的错误，静默处理
      if (!isOperationCurrent()) return;

      const error = e as TRPCClientError<any>;

      console.error('MCP plugin installation failed:', error);

      // 计算安装持续时间（失败情况）
      const installDurationMs = Date.now() - installStartTime;

      // 处理结构化错误信息
      let errorInfo: MCPErrorInfo;

      // 如果是结构化的 MCPError
      if (!!error.data && 'errorData' in error.data) {
        const mcpError = error.data.errorData as MCPErrorData;

        errorInfo = {
          message: mcpError.message,
          metadata: mcpError.metadata,
          type: mcpError.type,
        };
      } else {
        // 兜底处理普通错误
        const errorMessage = error instanceof Error ? error.message : String(error);
        errorInfo = {
          message: errorMessage,
          metadata: {
            step: 'installation_error',
            timestamp: Date.now(),
          },
          type: 'UNKNOWN_ERROR',
        };
      }

      // 设置错误状态，显示结构化错误信息
      if (!isOperationCurrent()) return;
      updateMCPInstallProgress(identifier, {
        errorInfo,
        progress: 0,
        step: MCPInstallStep.ERROR,
      });

      // 上报安装失败结果
      if (!isOperationCurrent()) return;
      try {
        await discoverService.reportMcpInstallResult(
          {
            errorCode: errorInfo.type,
            errorMessage: errorInfo.message,
            identifier: plugin.identifier,
            installDurationMs,
            installParams: connection,
            metadata: errorInfo.metadata,
            platform: 'web',
            success: false,
            userAgent,
            version: data?.version,
          },
          {
            isCurrent: isOperationCurrent,
            signal: abortController.signal,
          },
        );
      } catch (reportError) {
        console.warn('Failed to report failed MCP installation:', reportError);
      }
      if (!isOperationCurrent()) return;
    } finally {
      clearAbortController();
      releaseLoadingOperation();
    }
  },

  loadMoreMCPPlugins: () => {
    const { currentPage, totalPages } = get();

    // Filtering local-only entries changes the visible item count, so page
    // availability must follow the marketplace page boundary.
    if (currentPage < (totalPages || 0)) {
      set(
        produce((draft: MCPStoreState) => {
          draft.currentPage = currentPage + 1;
        }),
        false,
        n('loadMoreMCPPlugins'),
      );
    }
  },

  resetMCPPluginList: (keywords) => {
    set(
      produce((draft: MCPStoreState) => {
        draft.mcpPluginItems = [];
        draft.currentPage = 1;
        draft.mcpSearchKeywords = keywords;
      }),
      false,
      n('resetMCPPluginList'),
    );
  },

  // 测试 MCP 连接
  testMcpConnection: async (params) => {
    const { identifier, connection, metadata } = params;
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) {
      return { error: 'User scope is unavailable', success: false };
    }

    get().mcpTestAbortControllers[identifier]?.abort();
    const abortController = new AbortController();
    const isOperationCurrent = () =>
      !abortController.signal.aborted &&
      isToolMutationCurrent(checkpoint, get().scopeGeneration) &&
      get().mcpTestAbortControllers[identifier] === abortController;

    // 存储 AbortController 并设置加载状态
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) {
      return { error: 'User scope is unavailable', success: false };
    }
    set(
      produce((draft: MCPStoreState) => {
        draft.mcpTestAbortControllers[identifier] = abortController;
        draft.mcpTestLoading[identifier] = true;
        draft.mcpTestErrors[identifier] = '';
      }),
      false,
      n('testMcpConnection/start'),
    );

    try {
      let manifest: LobeChatPluginManifest;

      if (!connection.url) {
        throw new Error('URL is required for HTTP connection');
      }

      if (!isOperationCurrent()) return { error: 'Test cancelled', success: false };
      manifest = await mcpService.getStreamableMcpServerManifest(
        {
          auth: connection.auth,
          headers: connection.headers,
          identifier,
          metadata,
          url: connection.url,
        },
        abortController.signal,
      );

      // 检查是否已被取消
      if (!isOperationCurrent()) {
        return { error: 'Test cancelled', success: false };
      }

      // 清理状态
      set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          delete draft.mcpTestAbortControllers[identifier];
          delete draft.mcpTestErrors[identifier];
        }),
        false,
        n('testMcpConnection/success'),
      );

      return { manifest, success: true };
    } catch (error) {
      // 如果是因为取消导致的错误，静默处理
      if (!isOperationCurrent()) {
        return { error: 'Test cancelled', success: false };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // 设置错误状态
      set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          draft.mcpTestErrors[identifier] = errorMessage;
          delete draft.mcpTestAbortControllers[identifier];
        }),
        false,
        n('testMcpConnection/error'),
      );

      return { error: errorMessage, success: false };
    }
  },

  uninstallMCPPlugin: async (identifier) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await pluginService.uninstallPlugin(identifier);
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
  },

  updateMCPInstallProgress: (identifier, progress) => {
    set(
      produce((draft: MCPStoreState) => {
        draft.mcpInstallProgress[identifier] = progress;
      }),
      false,
      n(`updateMCPInstallProgress/${progress?.step || 'clear'}`),
    );
  },

  useFetchMCPPluginList: (params) => {
    const locale = globalHelpers.getCurrentLanguage();

    return useSWR<PluginListResponse>(
      ['useFetchMCPPluginList', locale, ...Object.values(params)].filter(Boolean).join('-'),
      () => discoverService.getMCPPluginList(params),
      {
        onSuccess(data) {
          const httpItems = data.items.filter((item) => item.connectionType !== 'local');

          set(
            produce((draft: MCPStoreState) => {
              draft.searchLoading = false;

              // 设置基础信息
              if (!draft.isMcpListInit) {
                draft.activeMCPIdentifier = httpItems[0]?.identifier;

                draft.isMcpListInit = true;
                draft.categories = data.categories;
                draft.totalCount = Math.max(
                  0,
                  data.totalCount - (data.items.length - httpItems.length),
                );
                draft.totalPages = data.totalPages;
              }

              // 累积数据逻辑
              if (params.page === 1) {
                // 第一页，直接设置
                draft.mcpPluginItems = uniqBy(httpItems, 'identifier');
              } else {
                // 后续页面，累积数据
                draft.mcpPluginItems = uniqBy(
                  [...draft.mcpPluginItems, ...httpItems],
                  'identifier',
                );
              }
            }),
            false,
            n('useFetchMCPPluginList/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});
