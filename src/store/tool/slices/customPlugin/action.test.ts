import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pluginService } from '@/services/plugin';
import { toolService } from '@/services/tool';
import { useUserStore } from '@/store/user';
import { DiscoverPluginItem } from '@/types/discover';
import { LobeToolCustomPlugin } from '@/types/tool/plugin';

import { useToolStore } from '../../store';
import { defaultCustomPlugin } from './initialState';

const originalRefreshPlugins = useToolStore.getState().refreshPlugins;
const originalUpdateInstallLoadingState = useToolStore.getState().updateInstallLoadingState;

beforeEach(() => {
  vi.resetAllMocks();
  useUserStore.setState({
    ownershipInvalidationGeneration: 0,
    userStateInitializationFailure: undefined,
  });
  useToolStore.setState({
    newCustomPlugin: defaultCustomPlugin,
    newCustomPluginRevision: 0,
    pluginInstallLoading: {},
    refreshPlugins: originalRefreshPlugins,
    scopeGeneration: 0,
    updateInstallLoadingState: originalUpdateInstallLoadingState,
  });
});
vi.mock('@/services/plugin', () => ({
  pluginService: {
    createCustomPlugin: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    updatePluginManifest: vi.fn(),
  },
}));

vi.mock('@/services/tool', () => ({
  toolService: {
    getToolManifest: vi.fn(),
  },
}));

describe('useToolStore:customPlugin', () => {
  describe('deleteCustomPlugin', () => {
    it('should delete custom plugin and related settings', async () => {
      // 设置初始状态和 mock 函数

      act(() => {
        useToolStore.setState({
          // ...其他状态
          installedPlugins: [{ identifier: 'test-plugin' } as LobeToolCustomPlugin],
        });
      });

      const { result } = renderHook(() => useToolStore());
      const pluginId = 'test-plugin';

      act(() => {
        result.current.uninstallCustomPlugin(pluginId);
      });

      expect(pluginService.uninstallPlugin).toBeCalledWith(pluginId);
    });
  });

  describe('saveToCustomPluginList', () => {
    it('should add a plugin to the custom plugin list and reset newCustomPlugin', async () => {
      const newPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: 'plugin2',
          meta: { title: 'New Plugin' },
        },
      } as LobeToolCustomPlugin;
      act(() => {
        useToolStore.setState({
          installedPlugins: [],
          newCustomPlugin: newPlugin,
          newCustomPluginRevision: 0,
        });
      });

      const { result } = renderHook(() => useToolStore());
      const refreshPlugins = vi.fn().mockResolvedValue(undefined);
      useToolStore.setState({ refreshPlugins, scopeGeneration: 6 });

      await act(async () => {
        await result.current.installCustomPlugin(newPlugin);
      });

      expect(result.current.newCustomPlugin).toEqual(defaultCustomPlugin);
      expect(pluginService.createCustomPlugin).toBeCalledWith(newPlugin);
      expect(refreshPlugins).toHaveBeenCalledWith(
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 6,
        }),
      );
    });

    it('preserves newer draft edits while an earlier submission completes', async () => {
      let resolveCreate!: () => void;
      vi.mocked(pluginService.createCustomPlugin).mockReturnValue(
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
      );
      const submittedPlugin = {
        identifier: 'plugin2',
        manifest: {
          identifier: 'plugin2',
          meta: { title: 'Submitted Plugin' },
        },
        type: 'customPlugin',
      } as LobeToolCustomPlugin;
      const newerDraft = {
        ...submittedPlugin,
        manifest: {
          ...submittedPlugin.manifest,
          meta: { title: 'Newer Draft' },
        },
      } as LobeToolCustomPlugin;
      useToolStore.setState({
        newCustomPlugin: submittedPlugin,
        newCustomPluginRevision: 0,
        refreshPlugins: vi.fn().mockResolvedValue(undefined),
      });

      const installPromise = useToolStore.getState().installCustomPlugin(submittedPlugin);

      useToolStore.getState().updateNewCustomPlugin(newerDraft);
      resolveCreate();
      await installPromise;

      expect(useToolStore.getState().newCustomPlugin).toEqual(newerDraft);
      expect(useToolStore.getState().newCustomPluginRevision).toBe(1);
    });

    it('does nothing during an active same-scope owner mismatch', async () => {
      const newPlugin = {
        identifier: 'plugin2',
        manifest: {
          identifier: 'plugin2',
          meta: { title: 'New Plugin' },
        },
        type: 'customPlugin',
      } as LobeToolCustomPlugin;
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      await useToolStore.getState().installCustomPlugin(newPlugin);

      expect(pluginService.createCustomPlugin).not.toHaveBeenCalled();
      expect(useToolStore.getState().newCustomPlugin).toEqual(defaultCustomPlugin);
    });
  });

  describe('plugin install loading ownership', () => {
    it('keeps the same-id marker until old-store and custom reinstall both finish', async () => {
      let resolveOldManifest!: (manifest: any) => void;
      let resolveCustomManifest!: (manifest: any) => void;
      vi.mocked(toolService.getToolManifest)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOldManifest = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveCustomManifest = resolve;
          }),
        );
      const customPlugin = {
        customParams: { manifestUrl: 'https://example.com/custom.json' },
        identifier: 'plugin1',
        manifest: {
          identifier: 'plugin1',
          meta: { title: 'Custom Plugin' },
        },
        type: 'customPlugin',
      } as LobeToolCustomPlugin;
      useToolStore.setState({
        oldPluginItems: [
          {
            identifier: 'plugin1',
            manifest: 'https://example.com/old.json',
            title: 'Old Plugin',
          } as DiscoverPluginItem,
        ],
        refreshPlugins: vi.fn().mockResolvedValue(undefined),
      });

      const oldInstallPromise = useToolStore.getState().installPlugin('plugin1');
      const customReinstallPromise = useToolStore
        .getState()
        .reinstallCustomPlugin('plugin1', customPlugin);

      expect(useToolStore.getState().pluginInstallLoading.plugin1).toBe(true);

      resolveOldManifest(customPlugin.manifest);
      await oldInstallPromise;

      expect(useToolStore.getState().pluginInstallLoading.plugin1).toBe(true);

      resolveCustomManifest(customPlugin.manifest);
      await customReinstallPromise;

      expect(useToolStore.getState().pluginInstallLoading.plugin1).toBeUndefined();
    });

    it('does not persist or clear loading after manifest fetch ownership invalidation', async () => {
      let resolveManifest!: (manifest: any) => void;
      vi.mocked(toolService.getToolManifest).mockReturnValue(
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
      );
      const customPlugin = {
        customParams: { manifestUrl: 'https://example.com/custom.json' },
        identifier: 'plugin1',
        manifest: {
          identifier: 'plugin1',
          meta: { title: 'Custom Plugin' },
        },
        type: 'customPlugin',
      } as LobeToolCustomPlugin;

      const reinstallPromise = useToolStore
        .getState()
        .reinstallCustomPlugin('plugin1', customPlugin);
      expect(useToolStore.getState().pluginInstallLoading.plugin1).toBe(true);

      useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      useToolStore.setState({
        pluginInstallLoading: { plugin1: true },
        scopeGeneration: 1,
      });
      resolveManifest(customPlugin.manifest);
      await reinstallPromise;

      expect(pluginService.updatePluginManifest).not.toHaveBeenCalled();
      expect(useToolStore.getState().pluginInstallLoading.plugin1).toBe(true);
    });
  });
  describe('updateCustomPlugin', () => {
    it('should update a specific plugin in the custom plugin list and reinstall the plugin', async () => {
      const pluginId = 'test-plugin';
      const old = {
        type: 'customPlugin',
        identifier: pluginId,
        manifest: {
          identifier: pluginId,
          meta: { title: 'Old Plugin', avatar: '🍎' },
        },
      } as LobeToolCustomPlugin;

      act(() => {
        useToolStore.setState({
          installedPlugins: [old],
        });
      });

      const { result } = renderHook(() => useToolStore());

      const updatedPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: pluginId,
          meta: { title: 'Updated Plugin', avatar: '🥒' },
        },
        identifier: pluginId,
      } as LobeToolCustomPlugin;

      await act(async () => {
        await result.current.updateCustomPlugin(pluginId, updatedPlugin);
      });

      expect(pluginService.updatePlugin).toHaveBeenCalledWith(pluginId, updatedPlugin);
    });
  });

  describe('updateNewCustomPlugin', () => {
    it('should update the newCustomPlugin state with the provided values', () => {
      const initialNewCustomPlugin = {
        type: 'customPlugin',
        manifest: {
          identifier: 'plugin3',
          meta: { title: 'Initial Plugin' },
        },
      } as LobeToolCustomPlugin;
      const updates = { meta: { title: 'Updated Name' } } as Partial<LobeToolCustomPlugin>;
      const expectedNewCustomPlugin = { ...initialNewCustomPlugin, ...updates };

      act(() => {
        useToolStore.setState({
          newCustomPlugin: initialNewCustomPlugin,
        });
      });

      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.updateNewCustomPlugin(updates);
      });

      expect(useToolStore.getState().newCustomPlugin).toEqual(expectedNewCustomPlugin);
    });
  });
});
