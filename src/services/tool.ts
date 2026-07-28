import { lambdaClient } from '@/libs/trpc/client';
import { createHeaderWithAuth } from '@/services/_auth';
import { globalHelpers } from '@/store/global/helpers';
import { PluginQueryParams } from '@/types/discover';
import { convertOpenAIManifestToLobeManifest, getToolManifest } from '@/utils/toolManifest';

class ToolService {
  getOldPluginList = async (params: PluginQueryParams): Promise<any> => {
    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getPluginList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  getToolManifest = async (url?: string, useProxy: boolean = false) => {
    const proxyRequestInit = useProxy
      ? {
          headers: await createHeaderWithAuth(),
        }
      : undefined;

    return getToolManifest(url, useProxy, proxyRequestInit);
  };
  convertOpenAIManifestToLobeManifest = convertOpenAIManifestToLobeManifest;
}

export const toolService = new ToolService();
