import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { PluginItem } from '@lobehub/market-sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { MCPInstallStep } from '@/types/plugins';

import { useToolStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

const serverManifest: LobeChatPluginManifest = {
  api: [],
  gateway: '',
  identifier: 'test-plugin',
  meta: {
    avatar: 'https://example.com/icon.png',
    description: 'Test description',
    title: 'Test Plugin',
  },
  type: 'standalone',
  version: '1.0.0',
};

const marketplacePlugin = {
  connectionType: 'remote',
  description: 'Test description',
  icon: 'https://example.com/icon.png',
  identifier: 'test-plugin',
  manifestUrl: 'https://example.com/manifest.json',
  name: 'Test Plugin',
} as PluginItem;

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    authUserId: 'user-id',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'user-id' },
    userStateInitializationFailure: undefined,
    userStateScope: 'user:user-id',
  });

  act(() => {
    useToolStore.setState(
      {
        categories: [],
        currentPage: 1,
        isMcpListInit: false,
        mcpInstallAbortControllers: {},
        mcpInstallProgress: {},
        mcpPluginItems: [],
        mcpTestAbortControllers: {},
        mcpTestErrors: {},
        mcpTestLoading: {},
        pluginInstallLoading: {},
        refreshPlugins: vi.fn(),
        scopeGeneration: 0,
        totalCount: 0,
        updateInstallLoadingState: vi.fn(),
      },
      false,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mcpStore actions', () => {
  it('updates and clears installation progress', () => {
    const { result } = renderHook(() => useToolStore());

    act(() => {
      result.current.updateMCPInstallProgress('test-plugin', {
        progress: 50,
        step: MCPInstallStep.GETTING_SERVER_MANIFEST,
      });
    });
    expect(result.current.mcpInstallProgress['test-plugin']).toEqual({
      progress: 50,
      step: MCPInstallStep.GETTING_SERVER_MANIFEST,
    });

    act(() => {
      result.current.updateMCPInstallProgress('test-plugin', undefined);
    });
    expect(result.current.mcpInstallProgress['test-plugin']).toBeUndefined();
  });

  it('aborts an in-progress installation', async () => {
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');
    useToolStore.setState({
      mcpInstallAbortControllers: { 'test-plugin': abortController },
      mcpInstallProgress: {
        'test-plugin': { progress: 50, step: MCPInstallStep.GETTING_SERVER_MANIFEST },
      },
    });

    await useToolStore.getState().cancelInstallMCPPlugin('test-plugin');

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(useToolStore.getState().mcpInstallAbortControllers['test-plugin']).toBeUndefined();
    expect(useToolStore.getState().mcpInstallProgress['test-plugin']).toBeUndefined();
  });

  it('tests an HTTP MCP connection', async () => {
    vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockResolvedValue(serverManifest);

    const result = await useToolStore.getState().testMcpConnection({
      connection: { type: 'http', url: 'https://example.com/mcp' },
      identifier: 'test-plugin',
    });

    expect(result).toEqual({ manifest: serverManifest, success: true });
    expect(mcpService.getStreamableMcpServerManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'test-plugin',
        url: 'https://example.com/mcp',
      }),
      expect.any(AbortSignal),
    );
  });

  it('rejects an HTTP connection without a URL', async () => {
    const result = await useToolStore.getState().testMcpConnection({
      connection: { type: 'http' } as any,
      identifier: 'test-plugin',
    });

    expect(result).toEqual({
      error: 'URL is required for HTTP connection',
      success: false,
    });
  });

  it('uninstalls a plugin and refreshes the server list', async () => {
    vi.spyOn(pluginService, 'uninstallPlugin').mockResolvedValue(undefined);

    await useToolStore.getState().uninstallMCPPlugin('test-plugin');

    expect(pluginService.uninstallPlugin).toHaveBeenCalledWith('test-plugin');
    expect(useToolStore.getState().refreshPlugins).toHaveBeenCalled();
  });

  it('loads another marketplace page only when more entries remain', () => {
    useToolStore.setState({
      currentPage: 1,
      totalPages: 2,
    });

    useToolStore.getState().loadMoreMCPPlugins();
    expect(useToolStore.getState().currentPage).toBe(2);

    useToolStore.getState().loadMoreMCPPlugins();
    expect(useToolStore.getState().currentPage).toBe(2);
  });

  it('excludes local-only marketplace entries', async () => {
    const localPlugin = {
      ...marketplacePlugin,
      connectionType: 'local',
      identifier: 'local-plugin',
    } as PluginItem;
    const response = {
      categories: ['utility'],
      currentPage: 1,
      items: [localPlugin, marketplacePlugin],
      pageSize: 20,
      totalCount: 2,
      totalPages: 1,
    };
    vi.spyOn(discoverService, 'getMCPPluginList').mockResolvedValue(response);
    vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

    const { result } = renderHook(() =>
      useToolStore.getState().useFetchMCPPluginList({ page: 1, pageSize: 20 }),
    );
    await waitFor(() => expect(result.current.data).toEqual(response));

    expect(useToolStore.getState().mcpPluginItems).toEqual([marketplacePlugin]);
    expect(useToolStore.getState().activeMCPIdentifier).toBe('test-plugin');
    expect(useToolStore.getState().totalCount).toBe(1);
  });

  it('installs a marketplace plugin through its recommended HTTP endpoint', async () => {
    useToolStore.setState({ mcpPluginItems: [marketplacePlugin] });
    vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue({
      deploymentOptions: [
        {
          connection: { type: 'http', url: 'https://example.com/mcp' },
          isRecommended: true,
        },
      ],
      name: 'Test Plugin',
      version: '1.0.0',
    } as any);
    vi.spyOn(mcpService, 'getStreamableMcpServerManifest').mockResolvedValue(serverManifest);
    vi.spyOn(pluginService, 'installPlugin').mockResolvedValue(undefined);
    vi.spyOn(discoverService, 'reportMcpInstallResult').mockResolvedValue(undefined as any);

    const installed = await useToolStore.getState().installMCPPlugin('test-plugin');

    expect(installed).toBe(true);
    expect(pluginService.installPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        customParams: {
          mcp: { type: 'http', url: 'https://example.com/mcp' },
        },
        identifier: 'test-plugin',
      }),
    );
  });

  it('rejects marketplace entries without an HTTP deployment', async () => {
    useToolStore.setState({ mcpPluginItems: [marketplacePlugin] });
    vi.spyOn(discoverService, 'getMCPPluginManifest').mockResolvedValue({
      deploymentOptions: [
        {
          connection: { args: ['server.js'], command: 'node', type: 'stdio' },
        },
      ],
      name: 'Legacy local plugin',
      version: '1.0.0',
    } as any);
    vi.spyOn(discoverService, 'reportMcpInstallResult').mockResolvedValue(undefined as any);
    const installPlugin = vi.spyOn(pluginService, 'installPlugin');

    const installed = await useToolStore.getState().installMCPPlugin('test-plugin');

    expect(installed).toBeUndefined();
    expect(installPlugin).not.toHaveBeenCalled();
    expect(useToolStore.getState().mcpInstallProgress['test-plugin']?.errorInfo?.message).toBe(
      'This marketplace entry does not provide an HTTP MCP endpoint.',
    );
  });
});
