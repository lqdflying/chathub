// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginStore } from '@/server/modules/PluginStore';
import { PluginSorts } from '@/types/discover';

import { DiscoverService } from './index';

// Mock external dependencies
vi.mock('@/server/modules/PluginStore');
vi.mock('@lobehub/market-sdk');
vi.mock('@/utils/toolManifest');
vi.mock('@/locales/resources', () => ({
  normalizeLocale: vi.fn((locale) => {
    if (locale === 'en-US') return 'en';
    return locale || 'en';
  }),
}));

// Set environment variable for tests
process.env.MARKET_BASE_URL = 'http://localhost:8787/api';

const mockPluginList = [
  {
    identifier: 'plugin-1',
    title: 'Test Plugin 1',
    description: 'A test plugin',
    author: 'Plugin Author',
    category: 'tools',
    createdAt: '2024-01-01T00:00:00Z',
    tags: ['test', 'plugin'],
    manifest: 'https://example.com/plugin1/manifest.json',
  },
  {
    identifier: 'plugin-2',
    title: 'Test Plugin 2',
    description: 'Another test plugin',
    author: 'Plugin Author 2',
    category: 'utilities',
    createdAt: '2024-01-02T00:00:00Z',
    tags: ['test', 'utility'],
    manifest: 'https://example.com/plugin2/manifest.json',
  },
];

describe('DiscoverService', () => {
  let service: DiscoverService;
  let mockPluginStore: any;
  let mockMarket: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup PluginStore mock
    mockPluginStore = {
      getPluginList: vi
        .fn()
        .mockResolvedValue(mockPluginList.map((item) => ({ ...item, meta: {} }))),
    };

    // Setup MarketSDK mock
    mockMarket = {
      plugins: {
        getCategories: vi.fn().mockResolvedValue([
          { category: 'tools', count: 5 },
          { category: 'utilities', count: 3 },
        ]),
        getPluginDetail: vi.fn().mockImplementation((params) => {
          const plugin = mockPluginList.find((p) => p.identifier === params.identifier);
          return Promise.resolve(plugin || null);
        }),
        getPluginList: vi.fn().mockResolvedValue({
          items: mockPluginList,
          totalCount: mockPluginList.length,
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
        }),
        getPublishedIdentifiers: vi
          .fn()
          .mockResolvedValue(
            mockPluginList.map((p) => ({ identifier: p.identifier, lastModified: p.createdAt })),
          ),
        getPluginManifest: vi.fn().mockResolvedValue({}),
      },
    };

    (PluginStore as any).mockImplementation(() => mockPluginStore);

    service = new DiscoverService();
    service.market = mockMarket;
  });

  describe('Plugin Market', () => {
    describe('getPluginList', () => {
      it('should return formatted plugin list with default parameters', async () => {
        const result = await service.getPluginList();

        expect(result).toEqual({
          currentPage: 1,
          pageSize: 20,
          totalCount: 2,
          totalPages: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              identifier: 'plugin-1',
              title: 'Test Plugin 1',
            }),
            expect.objectContaining({
              identifier: 'plugin-2',
              title: 'Test Plugin 2',
            }),
          ]),
        });
      });

      it('should filter by category', async () => {
        const result = await service.getPluginList({ category: 'tools' });

        expect(result.items).toHaveLength(1);
        expect(result.items[0].identifier).toBe('plugin-1');
      });

      it('should sort by identifier', async () => {
        const result = await service.getPluginList({
          sort: PluginSorts.Identifier,
          order: 'asc',
        });

        expect(result.items[0].identifier).toBe('plugin-2');
        expect(result.items[1].identifier).toBe('plugin-1');
      });
    });

    describe('getPluginDetail', () => {
      it('should return plugin detail with related items', async () => {
        const result = await service.getPluginDetail({
          identifier: 'plugin-1',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'plugin-1',
            title: 'Test Plugin 1',
            related: expect.any(Array),
          }),
        );
      });

      it('should return undefined for non-existent plugin', async () => {
        const result = await service.getPluginDetail({
          identifier: 'non-existent',
        });

        expect(result).toBeUndefined();
      });
    });
  });

  describe('MCP Market', () => {
    describe('getMcpList', () => {
      it('should call market SDK with normalized locale', async () => {
        await service.getMcpList({ locale: 'en-US' });

        expect(mockMarket.plugins.getPluginList).toHaveBeenCalledWith(
          expect.objectContaining({
            locale: 'en',
          }),
          expect.any(Object),
        );
      });
    });

    describe('getMcpDetail', () => {
      it('should return MCP detail with related items', async () => {
        const mockMcp = { identifier: 'mcp-1', category: 'tools' };
        mockMarket.plugins.getPluginDetail.mockResolvedValue(mockMcp);

        const result = await service.getMcpDetail({
          identifier: 'mcp-1',
        });

        expect(result).toEqual(
          expect.objectContaining({
            identifier: 'mcp-1',
            related: expect.any(Array),
          }),
        );
      });
    });
  });
});
