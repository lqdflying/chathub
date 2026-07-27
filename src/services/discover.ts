import { CategoryItem, CategoryListQuery, PluginManifest } from '@lobehub/market-sdk';
import { CallReportRequest, InstallReportRequest } from '@lobehub/market-types';

import { lambdaClient } from '@/libs/trpc/client';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import {
  DiscoverMcpDetail,
  DiscoverPluginDetail,
  IdentifiersResponse,
  McpListResponse,
  McpQueryParams,
  PluginListResponse,
  PluginQueryParams,
} from '@/types/discover';
import { MCPPluginListParams } from '@/types/plugins';
import { cleanObject } from '@/utils/object';

interface TelemetryContinuation {
  isCurrent?: () => boolean;
  signal?: AbortSignal;
}

class DiscoverService {
  private _isRetrying = false;

  // ============================== MCP Market ==============================

  getMcpCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    await this.injectMPToken();
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpCategories.query({
      ...params,
      locale,
    });
  };

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpDetail.query({
      ...params,
      locale,
    });
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    await this.injectMPToken();
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  getMCPPluginList = async (params: MCPPluginListParams): Promise<McpListResponse> => {
    await this.injectMPToken();

    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getMcpList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    });
  };

  getMcpManifest = async (params: { identifier: string; locale?: string; version?: string }) => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpManifest.query({
      ...params,
      locale,
    });
  };

  getMCPPluginManifest = async (
    identifier: string,
    options: { install?: boolean } = {},
  ): Promise<PluginManifest> => {
    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getMcpManifest.query({
      identifier,
      install: options.install,
      locale,
    });
  };

  registerClient = () => {
    return lambdaClient.market.registerClientInMarketplace.mutate({});
  };

  reportMcpInstallResult = async (
    { success, manifest, errorMessage, errorCode, ...params }: InstallReportRequest,
    continuation: TelemetryContinuation = {},
  ) => {
    const canContinue = () =>
      !continuation.signal?.aborted && (continuation.isCurrent?.() ?? true);
    if (!canContinue()) return;

    const allow = preferenceSelectors.userAllowTrace(useUserStore.getState());

    if (!allow) return;
    try {
      await this.injectMPToken();
    } catch (tokenError) {
      console.warn('Failed to prepare MCP installation telemetry:', tokenError);
      return;
    }

    const reportData = {
      errorCode: success ? undefined : errorCode,
      errorMessage: success ? undefined : errorMessage,
      manifest: success ? manifest : undefined,
      success,
      ...params,
    };

    try {
      if (!canContinue()) return;
      await lambdaClient.market.reportMcpInstallResult.mutate(cleanObject(reportData));
    } catch (reportError) {
      console.warn('Failed to report MCP installation result:', reportError);
    }
  };

  reportPluginCall = async (reportData: CallReportRequest) => {
    const allow = preferenceSelectors.userAllowTrace(useUserStore.getState());

    if (!allow) return;

    await this.injectMPToken();

    lambdaClient.market.reportCall.mutate(cleanObject(reportData)).catch((reportError) => {
      console.warn('Failed to report call:', reportError);
    });
  };

  // ============================== Plugin Market ==============================

  getPluginCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    await this.injectMPToken();
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginCategories.query({
      ...params,
      locale,
    });
  };

  getPluginDetail = async (params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginDetail.query({
      ...params,
      locale,
    });
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getPluginIdentifiers.query();
  };

  getPluginList = async (params: PluginQueryParams = {}): Promise<PluginListResponse> => {
    await this.injectMPToken();
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  // ============================== Helpers ==============================

  private async injectMPToken() {
    if (typeof localStorage === 'undefined') return;

    // 检查服务端设置的状态标记 cookie
    const tokenStatus = this.getTokenStatusFromCookie();
    if (tokenStatus === 'active') return;

    let clientId: string;
    let clientSecret: string;

    // 1. 从 localStorage 获取客户端信息
    const item = localStorage.getItem('_mpc');
    if (!item) {
      // 2. 如果没有，则注册客户端
      let clientInfo: { clientId: string; clientSecret: string };
      try {
        clientInfo = await this.registerClient();
      } catch (error) {
        console.warn('Market client registration unavailable:', error);
        return;
      }
      clientId = clientInfo.clientId;
      clientSecret = clientInfo.clientSecret;

      // 3. Base64 编码并保存到 localStorage
      const clientData = JSON.stringify({ clientId, clientSecret });
      const encodedData = btoa(clientData);
      localStorage.setItem('_mpc', encodedData);
    } else {
      // 4. 如果有，则解码获取客户端信息
      try {
        const decodedData = atob(item);
        const clientData = JSON.parse(decodedData);
        clientId = clientData.clientId;
        clientSecret = clientData.clientSecret;
      } catch (error) {
        console.error('Failed to decode client data:', error);
        // 如果解码失败，重新注册
        let clientInfo: { clientId: string; clientSecret: string };
        try {
          clientInfo = await this.registerClient();
        } catch (regError) {
          console.warn('Market client re-registration unavailable:', regError);
          return;
        }
        clientId = clientInfo.clientId;
        clientSecret = clientInfo.clientSecret;

        const clientData = JSON.stringify({ clientId, clientSecret });
        const encodedData = btoa(clientData);
        localStorage.setItem('_mpc', encodedData);
      }
    }

    // 5. 获取访问令牌（服务端会自动设置 HTTP-Only cookie）
    try {
      const result = await lambdaClient.market.registerM2MToken.query({
        clientId,
        clientSecret,
      });

      // 检查服务端返回的结果
      if (!result.success) {
        console.warn(
          'Token registration failed, client credentials may be invalid. Clearing and retrying...',
        );

        // 清空相关的本地存储数据
        localStorage.removeItem('_mpc');

        // 重新执行完整的注册流程（但只重试一次）
        if (!this._isRetrying) {
          this._isRetrying = true;
          try {
            await this.injectMPToken();
          } finally {
            this._isRetrying = false;
          }
        } else {
          console.error('Failed to re-register after credential invalidation');
        }

        return;
      }
    } catch (error) {
      console.error('Failed to register M2M token:', error);
      return null;
    }
  }

  private getTokenStatusFromCookie(): string | null {
    if (typeof document === 'undefined') return null;

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'mp_token_status') {
        return value;
      }
    }
    return null;
  }
}

export const discoverService = new DiscoverService();
