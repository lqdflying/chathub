import { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { useUserStore } from '@/store/user';
import { initialState as initialUserState } from '@/store/user/initialState';
import { DiscoverPluginItem } from '@/types/discover';

import { useToolStore } from '../../store';

const initialToolState = useToolStore.getInitialState();

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
  },
}));
// Mock the pluginService.getToolList method
vi.mock('@/services/plugin', () => ({
  pluginService: {
    uninstallPlugin: vi.fn(),
    installPlugin: vi.fn(),
  },
}));

vi.mock('@/services/tool', () => ({
  toolService: {
    getToolManifest: vi.fn(),
    getToolList: vi.fn(),
    getOldPluginList: vi.fn(),
  },
}));

// Mock i18next
vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

const pluginManifestMock = {
  $schema: '../node_modules/@lobehub/chat-plugin-sdk/schema.json',
  api: [
    {
      url: 'https://realtime-weather.chat-plugin.lobehub.com/api/v1',
      name: 'fetchCurrentWeather',
      description: '获取当前天气情况',
      parameters: {
        properties: {
          city: {
            description: '城市名称',
            type: 'string',
          },
        },
        required: ['city'],
        type: 'object',
      },
    },
  ],
  author: 'ChatHub',
  createAt: '2023-08-12',
  homepage: 'https://github.com/lobehub/chat-plugin-realtime-weather',
  identifier: 'realtime-weather',
  meta: {
    avatar: '🌈',
    tags: ['weather', 'realtime'],
    title: 'Realtime Weather',
    description: 'Get realtime weather information',
  },
  ui: {
    url: 'https://realtime-weather.chat-plugin.lobehub.com/iframe',
    height: 310,
  },
  version: '1',
};

const logError = console.error;
const originalRefreshPlugins = useToolStore.getState().refreshPlugins;
const originalUpdateInstallLoadingState = useToolStore.getState().updateInstallLoadingState;

beforeEach(() => {
  vi.restoreAllMocks();
  useToolStore.setState(initialToolState, true);
  useUserStore.setState(
    {
      ...initialUserState,
      authUserId: 'account-a',
      isLoaded: true,
      isSignedIn: true,
      ownershipInvalidationGeneration: 0,
      user: { id: 'account-a' },
      userStateInitializationFailure: undefined,
    },
    true,
  );
  useToolStore.setState({
    oldPluginItems: [
      {
        identifier: 'plugin1',
        title: 'plugin1',
        avatar: '🍏',
        manifest: 'https://abc.com/manifest.json',
      } as DiscoverPluginItem,
    ],
    pluginInstallLoading: {},
    pluginInstallProgress: {},
    refreshPlugins: originalRefreshPlugins,
    scopeGeneration: 0,
    updateInstallLoadingState: originalUpdateInstallLoadingState,
  });
  console.error = () => {};
});
afterEach(() => {
  console.error = logError;
});

describe('useToolStore:pluginStore', () => {
  describe('loadPluginStore', () => {
    it('should load plugin list and update state', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (toolService.getOldPluginList as Mock).mockResolvedValue({ items: pluginListMock });

      // When
      let pluginList;
      await act(async () => {
        pluginList = await useToolStore.getState().loadPluginStore();
      });

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(pluginList).toEqual(pluginListMock);
      expect(useToolStore.getState().oldPluginItems).toEqual(pluginListMock);
    });

    it('should handle errors when loading plugin list', async () => {
      // Given
      const error = new Error('Failed to load plugin list');
      (toolService.getOldPluginList as Mock).mockRejectedValue(error);

      // When
      let pluginList;
      let errorOccurred = false;
      try {
        await act(async () => {
          pluginList = await useToolStore.getState().loadPluginStore();
        });
      } catch (e) {
        errorOccurred = true;
      }

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(errorOccurred).toBe(true);
      expect(pluginList).toBeUndefined();
      // Ensure the state is not updated with an undefined value
      expect(useToolStore.getState().oldPluginItems).not.toBeUndefined();
    });

    it('does not write delayed plugin items after the tool scope resets', async () => {
      let resolvePluginList!: (value: { items: DiscoverPluginItem[] }) => void;
      vi.mocked(toolService.getOldPluginList).mockReturnValue(
        new Promise((resolve) => {
          resolvePluginList = resolve;
        }),
      );
      const staleItems = [{ identifier: 'stale-plugin' }] as DiscoverPluginItem[];
      const currentItems = [{ identifier: 'current-plugin' }] as DiscoverPluginItem[];

      const loadPromise = useToolStore.getState().loadPluginStore();

      useToolStore.setState({
        oldPluginItems: currentItems,
        scopeGeneration: 1,
      });
      resolvePluginList({ items: staleItems });

      await expect(loadPromise).resolves.toEqual(staleItems);
      expect(useToolStore.getState().oldPluginItems).toEqual(currentItems);
    });

    it('keeps direct public marketplace loading available during owner mismatch', async () => {
      const pluginListMock = [{ identifier: 'plugin1' }] as DiscoverPluginItem[];
      vi.mocked(toolService.getOldPluginList).mockResolvedValue({ items: pluginListMock });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });

      await expect(useToolStore.getState().loadPluginStore()).resolves.toEqual(pluginListMock);

      expect(toolService.getOldPluginList).toHaveBeenCalledTimes(1);
      expect(useToolStore.getState().oldPluginItems).toEqual(pluginListMock);
    });
  });

  describe('useFetchPluginStore', () => {
    it('should fetch plugin store data', async () => {
      // Given
      const pluginListMock = [{ identifier: 'plugin1' }, { identifier: 'plugin2' }];
      (toolService.getOldPluginList as Mock).mockResolvedValue({ items: pluginListMock });

      // When
      const { result } = renderHook(() => useToolStore().useFetchPluginStore());

      // Wait for SWR to fetch data
      await waitFor(() => {
        expect(result.current.data).toEqual(pluginListMock);
      });

      // Then
      expect(toolService.getOldPluginList).toHaveBeenCalled();
      expect(result.current.error).toBeUndefined();
    });

    // Note: Error handling test is not included because SWR retries by default,
    // making error scenarios difficult to test in unit tests.
    // The underlying loadPluginStore error handling is tested separately above.
  });

  describe('installPlugin', () => {
    it('should install a plugin with valid manifest', async () => {
      const pluginIdentifier = 'plugin1';
      const checkpoint = {
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'user:account-a',
        },
        scopeGeneration: 0,
      };

      const originalUpdateInstallLoadingState = useToolStore.getState().updateInstallLoadingState;
      const updateInstallLoadingStateMock = vi.fn();
      const refreshPluginsMock = vi.fn().mockResolvedValue(undefined);

      act(() => {
        useToolStore.setState({
          refreshPlugins: refreshPluginsMock,
          updateInstallLoadingState: updateInstallLoadingStateMock,
        });
      });

      const pluginManifestMock = {
        $schema: '../node_modules/@lobehub/chat-plugin-sdk/schema.json',
        api: [
          {
            url: 'https://realtime-weather.chat-plugin.lobehub.com/api/v1',
            name: 'fetchCurrentWeather',
            description: '获取当前天气情况',
            parameters: {
              properties: {
                city: {
                  description: '城市名称',
                  type: 'string',
                },
              },
              required: ['city'],
              type: 'object',
            },
          },
        ],
        author: 'ChatHub',
        createAt: '2023-08-12',
        homepage: 'https://github.com/lobehub/chat-plugin-realtime-weather',
        identifier: 'realtime-weather',
        meta: {
          avatar: '🌈',
          tags: ['weather', 'realtime'],
          title: 'Realtime Weather',
          description: 'Get realtime weather information',
        },
        ui: {
          url: 'https://realtime-weather.chat-plugin.lobehub.com/iframe',
          height: 310,
        },
        version: '1',
      };
      (toolService.getToolManifest as Mock).mockResolvedValue(pluginManifestMock);

      await act(async () => {
        await useToolStore.getState().installPlugin(pluginIdentifier, 'plugin', checkpoint);
      });

      // Then
      expect(toolService.getToolManifest).toHaveBeenCalled();
      expect(notification.error).not.toHaveBeenCalled();
      expect(updateInstallLoadingStateMock).toHaveBeenCalledTimes(2);
      expect(pluginService.installPlugin).toHaveBeenCalledWith({
        identifier: 'plugin1',
        type: 'plugin',
        manifest: pluginManifestMock,
      });
      expect(refreshPluginsMock).toHaveBeenCalledWith(checkpoint);
      expect(refreshPluginsMock.mock.calls[0][0]).toBe(checkpoint);

      act(() => {
        useToolStore.setState({
          refreshPlugins: originalRefreshPlugins,
          updateInstallLoadingState: originalUpdateInstallLoadingState,
        });
      });
    });

    it('should throw error with no error', async () => {
      // Given

      const error = new TypeError('noManifest');

      // Mock necessary modules and functions
      (toolService.getToolManifest as Mock).mockRejectedValue(error);

      useToolStore.setState({
        oldPluginItems: [
          {
            identifier: 'plugin1',
            title: 'plugin1',
            avatar: '🍏',
          } as DiscoverPluginItem,
        ],
      });

      await act(async () => {
        await useToolStore.getState().installPlugin('plugin1');
      });

      expect(notification.error).toHaveBeenCalledWith({
        description: 'error.noManifest',
        message: 'error.installError',
      });
    });

    it('does nothing while the active account has a same-scope owner mismatch', async () => {
      const updateInstallLoadingState = vi.fn();
      useToolStore.setState({ updateInstallLoadingState });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });

      await useToolStore.getState().installPlugin('plugin1');

      expect(updateInstallLoadingState).not.toHaveBeenCalled();
      expect(toolService.getToolManifest).not.toHaveBeenCalled();
      expect(pluginService.installPlugin).not.toHaveBeenCalled();
    });

    it('stops after manifest fetch when account ownership is invalidated', async () => {
      let resolveManifest!: (manifest: typeof pluginManifestMock) => void;
      vi.mocked(toolService.getToolManifest).mockReturnValue(
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
      );
      const updateInstallLoadingState = vi.fn();
      const refreshPlugins = vi.fn();
      useToolStore.setState({ refreshPlugins, updateInstallLoadingState });

      const installPromise = useToolStore.getState().installPlugin('plugin1');
      expect(updateInstallLoadingState).toHaveBeenCalledWith('plugin1', true);

      useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      resolveManifest(pluginManifestMock);
      await installPromise;

      expect(pluginService.installPlugin).not.toHaveBeenCalled();
      expect(refreshPlugins).not.toHaveBeenCalled();
      expect(updateInstallLoadingState).not.toHaveBeenCalledWith('plugin1', undefined);
    });

    it('rejects a stale install after an A-B-A account transition', async () => {
      let resolveManifest!: (manifest: typeof pluginManifestMock) => void;
      vi.mocked(toolService.getToolManifest).mockReturnValue(
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
      );

      const installPromise = useToolStore.getState().installPlugin('plugin1');
      useUserStore.setState({
        authUserId: 'account-b',
        ownershipInvalidationGeneration: 1,
        user: { id: 'account-b' },
      });
      useUserStore.setState({
        authUserId: 'account-a',
        ownershipInvalidationGeneration: 2,
        user: { id: 'account-a' },
      });

      resolveManifest(pluginManifestMock);
      await installPromise;

      expect(pluginService.installPlugin).not.toHaveBeenCalled();
    });

    it('does not let an overlapped install clear the newer operation', async () => {
      let resolveFirstManifest!: (manifest: typeof pluginManifestMock) => void;
      let resolveSecondManifest!: (manifest: typeof pluginManifestMock) => void;
      vi.mocked(toolService.getToolManifest)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirstManifest = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSecondManifest = resolve;
          }),
        );
      const updateInstallLoadingState = vi.fn();
      const refreshPlugins = vi.fn().mockResolvedValue(undefined);
      useToolStore.setState({ refreshPlugins, updateInstallLoadingState });

      const firstInstallPromise = useToolStore.getState().installPlugin('plugin1');
      const secondInstallPromise = useToolStore.getState().installPlugin('plugin1');

      resolveFirstManifest(pluginManifestMock);
      await firstInstallPromise;
      expect(updateInstallLoadingState).not.toHaveBeenCalledWith('plugin1', undefined);

      resolveSecondManifest(pluginManifestMock);
      await secondInstallPromise;

      expect(pluginService.installPlugin).toHaveBeenCalledTimes(1);
      expect(updateInstallLoadingState).toHaveBeenLastCalledWith('plugin1', undefined);
    });
  });

  describe('installPlugins', () => {
    it('should install multiple plugins', async () => {
      // Given
      act(() => {
        useToolStore.setState({
          oldPluginItems: [
            {
              identifier: 'plugin1',
              title: 'plugin1',
              avatar: '🍏',
              manifest: 'https://abc.com/manifest.json',
            } as DiscoverPluginItem,
            {
              identifier: 'plugin2',
              title: 'plugin2',
              avatar: '🍏',
              manifest: 'https://abc.com/manifest.json',
            } as DiscoverPluginItem,
          ],
        });
      });

      const plugins = ['plugin1', 'plugin2'];

      (toolService.getToolManifest as Mock).mockResolvedValue(pluginManifestMock);

      // When
      await act(async () => {
        await useToolStore.getState().installPlugins(plugins);
      });

      expect(pluginService.installPlugin).toHaveBeenCalledTimes(2);
    });
  });

  describe('unInstallPlugin', () => {
    it('should uninstall a plugin and remove its manifest', async () => {
      // Given
      const pluginIdentifier = 'plugin1';
      act(() => {
        useToolStore.setState({
          installedPlugins: [
            {
              identifier: pluginIdentifier,
              type: 'plugin',
              manifest: {
                identifier: pluginIdentifier,
                meta: {},
              } as LobeChatPluginManifest,
            },
          ],
        });
      });

      // When
      act(() => {
        useToolStore.getState().uninstallPlugin(pluginIdentifier);
      });

      // Then
      expect(pluginService.uninstallPlugin).toBeCalledWith(pluginIdentifier);
    });
  });

  describe('updateInstallLoadingState', () => {
    it('should update the loading state for a plugin', () => {
      const pluginIdentifier = 'abc';
      const loadingState = true;
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });

    it('should clear the loading state for a plugin', () => {
      // Given
      const pluginIdentifier = 'dddd';
      const loadingState = undefined;

      act(() => {
        useToolStore.setState({ pluginInstallLoading: { [pluginIdentifier]: true } });
      });
      const { result } = renderHook(() => useToolStore());

      // When
      act(() => {
        result.current.updateInstallLoadingState(pluginIdentifier, loadingState);
      });

      // Then
      expect(result.current.pluginInstallLoading[pluginIdentifier]).toBe(loadingState);
    });
  });
});
