import {
  CURRENT_VERSION,
  DEFAULT_DISCOVER_PLUGIN_ITEM,
  isDesktop,
} from '@lobechat/const';
import {
  CacheRevalidate,
  CacheTag,
  DiscoverMcpDetail,
  DiscoverPluginDetail,
  DiscoverPluginItem,
  IdentifiersResponse,
  McpListResponse,
  McpQueryParams,
  PluginListResponse,
  PluginQueryParams,
  PluginSorts,
} from '@lobechat/types';
import { CategoryItem, CategoryListQuery, MarketSDK } from '@lobehub/market-sdk';
import { CallReportRequest, InstallReportRequest } from '@lobehub/market-types';
import dayjs from 'dayjs';
import debug from 'debug';
import { cloneDeep, countBy, isString, merge } from 'lodash-es';

import { normalizeLocale } from '@/locales/resources';
import { PluginStore } from '@/server/modules/PluginStore';

const log = debug('lobe-server:discover');

export class DiscoverService {
  pluginStore = new PluginStore();
  market: MarketSDK;

  constructor({ accessToken }: { accessToken?: string } = {}) {
    this.market = new MarketSDK({
      accessToken,
      baseURL: process.env.MARKET_BASE_URL,
    });
    log('DiscoverService initialized with market baseURL: %s', process.env.MARKET_BASE_URL);
  }

  async registerClient({ userAgent }: { userAgent?: string }) {
    const getDeviceId = async (): Promise<string> => {
      // 1. Vercel 环境下使用 VERCEL_PROJECT_ID
      if (process.env.VERCEL_PROJECT_ID) {
        return process.env.VERCEL_PROJECT_ID;
      }

      // 2. 桌面端使用 machine-id
      if (isDesktop) {
        try {
          // 动态导入
          const { machineId } = await import('node-machine-id');
          return await machineId();
        } catch (error) {
          console.error('Failed to get machine-id:', error);
        }
      }

      return 'unknown-device';
    };

    const deviceId = await getDeviceId();

    const { client_id, client_secret } = await this.market.registerClient({
      clientName: `ChatHub ${isDesktop ? 'Desktop' : 'Web'}`,
      clientType: isDesktop ? 'desktop' : 'web',
      deviceId,
      platform: isDesktop ? process.platform : userAgent,
      version: CURRENT_VERSION,
    });

    return { clientId: client_id, clientSecret: client_secret };
  }

  async fetchM2MToken(params: { clientId: string; clientSecret: string }) {
    // 使用传入的客户端凭证创建新的 MarketSDK 实例
    const tokenMarket = new MarketSDK({
      baseURL: process.env.MARKET_BASE_URL,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    });

    const tokenInfo = await tokenMarket.fetchM2MToken();

    return {
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.expiresIn,
    };
  }

  // ============================== MCP Market ==============================

  getMcpCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getMcpCategories: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getCategories(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: 3600,
        },
      },
    );
    log('getMcpCategories: returning %d categories', result.length);
    return result;
  };

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    log('getMcpDetail: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const mcp = await this.market.plugins.getPluginDetail(
      { ...params, locale: normalizedLocale },
      {
        next: {
          revalidate: 3600,
        },
      },
    );
    const list = await this.getMcpList({
      category: mcp.category,
      locale,
      page: 1,
      pageSize: 7,
    });
    const result = {
      ...mcp,
      related: list.items.filter((item) => item.identifier !== mcp.identifier).slice(0, 6),
    };
    log('getMcpDetail: returning mcp with %d related items', result.related.length);
    return result;
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    log('getMcpList: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getPluginList(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpList: returning %d items on page %d', result.items.length, result.currentPage);
    return result;
  };

  getMcpManifest = async (params: { identifier: string; locale?: string; version?: string }) => {
    log('getMcpManifest: params=%O', params);
    const { locale } = params;
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.market.plugins.getPluginManifest(
      {
        ...params,
        locale: normalizedLocale,
      },
      {
        next: {
          revalidate: CacheRevalidate.List,
          tags: [CacheTag.Discover, CacheTag.MCP],
        },
      },
    );
    log('getMcpManifest: returning manifest for %s', params.identifier);
    return result;
  };

  // ============================== MCP Analytics ==============================

  /**
   * report MCP plugin result marketplace
   */
  reportPluginInstallation = async (params: InstallReportRequest) => {
    await this.market.plugins.reportInstallation(params);
  };

  /**
   * report plugin call result to marketplace
   */
  reportCall = async (params: CallReportRequest) => {
    await this.market.plugins.reportCall(params);
  };

  // ============================== Plugin Market ==============================

  private _getPluginList = async (locale?: string): Promise<DiscoverPluginItem[]> => {
    log('_getPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const list = await this.pluginStore.getPluginList(normalizedLocale);
    if (!list || !Array.isArray(list)) {
      log('_getPluginList: no valid list found, returning empty array');
      return [];
    }
    const result = list.map(({ meta, ...item }) => ({ ...item, ...meta }));
    log('_getPluginList: returning %d items', result.length);
    return result;
  };

  getLegacyPluginList = async ({ locale }: { locale?: string } = {}): Promise<any> => {
    log('getLegacyPluginList: locale=%s', locale);
    const normalizedLocale = normalizeLocale(locale);
    const result = await this.pluginStore.getPluginList(normalizedLocale);
    log('getLegacyPluginList: returning plugin list');
    return result;
  };

  getPluginCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    log('getPluginCategories: params=%O', params);
    const { q, locale } = params;
    let list = await this._getPluginList(locale);
    if (q) {
      const originalCount = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log(
        'getPluginCategories: filtered by query "%s", %d -> %d items',
        q,
        originalCount,
        list.length,
      );
    }
    const categoryCounts = countBy(list, (item) => item.category);
    const result = Object.entries(categoryCounts)
      .filter(([category]) => Boolean(category)) // 过滤掉空值
      .map(([category, count]) => ({
        category,
        count,
      }));
    log('getPluginCategories: returning %d categories', result.length);
    return result;
  };

  getPluginDetail = async (params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    log('getPluginDetail: params=%O', params);
    const { locale, identifier, withManifest } = params;
    const all = await this._getPluginList(locale);
    let raw = all.find((item) => item.identifier === identifier);
    if (!raw) {
      log('getPluginDetail: plugin not found for identifier=%s', identifier);
      return;
    }

    raw = merge(cloneDeep(DEFAULT_DISCOVER_PLUGIN_ITEM), raw);
    const list = await this.getPluginList({
      category: raw.category,
      locale,
      page: 1,
      pageSize: 7,
    });

    let plugin = {
      ...raw,
      related: list.items.filter((item) => item.identifier !== raw.identifier).slice(0, 6),
    };

    if (!withManifest || !plugin?.manifest || !isString(plugin?.manifest)) {
      log('getPluginDetail: returning plugin without manifest processing');
      return plugin;
    }

    // 在 Edge Runtime 环境中使用了 Node.js 的 path 模块，但 Edge Runtime 不支持所有 Node.js API
    // 这个函数使用了 @lobehub/chat-plugin-sdk/openapi，该包最终依赖了 @apidevtools/swagger-parser，而这个包在 Edge Runtime 环境中使用了不被支持的 Node.js path 模块。
    // try {
    //   const manifest = await getToolManifest(plugin.manifest);
    //
    //   return {
    //     ...plugin,
    //     manifest,
    //   };
    // } catch {
    //   return plugin;
    // }

    return plugin;
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => {
    log('getPluginIdentifiers: fetching identifiers');
    const list = await this._getPluginList();
    const result = list.map((item) => {
      return {
        identifier: item.identifier,
        lastModified: item.createdAt,
      };
    });
    log('getPluginIdentifiers: returning %d identifiers', result.length);
    return result;
  };

  getPluginList = async (params: PluginQueryParams = {}): Promise<PluginListResponse> => {
    log('getPluginList: params=%O', params);
    const {
      locale,
      category,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort = PluginSorts.CreatedAt,
    } = params;

    let list = await this._getPluginList(locale);
    const originalCount = list.length;

    if (category) {
      list = list.filter((item) => item.category === category);
      log(
        'getPluginList: filtered by category "%s", %d -> %d items',
        category,
        originalCount,
        list.length,
      );
    }

    if (q) {
      const beforeFilter = list.length;
      list = list.filter((item) => {
        return [item.author, item.title, item.description, item?.tags]
          .flat()
          .filter(Boolean)
          .join(',')
          .toLowerCase()
          .includes(decodeURIComponent(q).toLowerCase());
      });
      log('getPluginList: filtered by query "%s", %d -> %d items', q, beforeFilter, list.length);
    }

    if (sort) {
      log('getPluginList: sorting by %s %s', sort, order);
      switch (sort) {
        case PluginSorts.CreatedAt: {
          list = list.sort((a, b) => {
            if (order === 'asc') {
              return dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix();
            } else {
              return dayjs(b.createdAt).unix() - dayjs(a.createdAt).unix();
            }
          });
          break;
        }
        case PluginSorts.Identifier: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.identifier.localeCompare(b.identifier);
            } else {
              return b.identifier.localeCompare(a.identifier);
            }
          });
          break;
        }
        case PluginSorts.Title: {
          list = list.sort((a, b) => {
            if (order === 'desc') {
              return a.title.localeCompare(b.title);
            } else {
              return b.title.localeCompare(a.title);
            }
          });
          break;
        }
      }
    }

    const result = {
      currentPage: page,
      items: list.slice((page - 1) * pageSize, page * pageSize),
      pageSize,
      totalCount: list.length,
      totalPages: Math.ceil(list.length / pageSize),
    };
    log(
      'getPluginList: returning page %d/%d with %d items',
      page,
      result.totalPages,
      result.items.length,
    );
    return result;
  };

}
