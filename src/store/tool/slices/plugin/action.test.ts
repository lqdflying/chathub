import { LobeTool } from '@lobechat/types';
import { LobeChatPluginMeta } from '@lobehub/chat-plugin-sdk';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pluginService } from '@/services/plugin';
import { useUserStore } from '@/store/user';
import { DiscoverPluginItem } from '@/types/discover';
import { merge } from '@/utils/merge';

import { useToolStore } from '../../store';

vi.mock('@/services/plugin', () => ({
  pluginService: {
    updatePluginSettings: vi.fn(),
    removeAllPlugins: vi.fn(),
  },
}));

beforeEach(() => {
  // Reset all mocks before each test
  vi.resetAllMocks();
  useUserStore.setState({ userStateInitializationFailure: undefined });
});

describe('useToolStore:plugin', () => {
  describe('checkPluginsIsInstalled', () => {
    it('should not perform any operations if the plugin list is empty', async () => {
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: vi.fn(),
        installPlugins: installPluginsMock,
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled([]);
      });

      expect(installPluginsMock).not.toHaveBeenCalled();
    });

    it('should load the plugin store and install plugins if necessary', async () => {
      const plugins = ['plugin1', 'plugin2'];
      const loadPluginStoreMock = vi.fn();
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: loadPluginStoreMock,
        installPlugins: installPluginsMock,
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled(plugins);
      });

      expect(loadPluginStoreMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: expect.any(Number),
        }),
      );
      expect(installPluginsMock).toHaveBeenCalledWith(
        plugins,
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: expect.any(Number),
        }),
      );
      expect(installPluginsMock.mock.calls[0][1]).toBe(loadPluginStoreMock.mock.calls[0][0]);
    });

    it('does not install plugins after a delayed store load is invalidated', async () => {
      const plugins = ['plugin1'];
      let resolvePluginStore!: () => void;
      const loadPluginStoreMock = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePluginStore = resolve;
          }),
      );
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        installedPlugins: [],
        loadPluginStore: loadPluginStoreMock,
        installPlugins: installPluginsMock,
        oldPluginItems: [],
        scopeGeneration: 0,
      });

      const installCheckPromise = useToolStore.getState().checkPluginsIsInstalled(plugins);

      expect(loadPluginStoreMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accountMutationSnapshot: expect.any(Object),
          scopeGeneration: 0,
        }),
      );

      useToolStore.setState({ oldPluginItems: [], scopeGeneration: 1 });
      resolvePluginStore();
      await installCheckPromise;

      expect(installPluginsMock).not.toHaveBeenCalled();
      expect(useToolStore.getState().oldPluginItems).toEqual([]);
    });

    it('should not load the plugin store and install plugins', async () => {
      const plugins = ['plugin1', 'plugin2'];
      const loadPluginStoreMock = vi.fn();
      const installPluginsMock = vi.fn();
      useToolStore.setState({
        loadPluginStore: loadPluginStoreMock,
        installPlugins: installPluginsMock,
        installedPlugins: [{ identifier: 'abc' }] as LobeTool[],
        oldPluginItems: [{ identifier: 'abc' }] as DiscoverPluginItem[],
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.checkPluginsIsInstalled(plugins);
      });

      expect(loadPluginStoreMock).not.toHaveBeenCalled();
      expect(installPluginsMock).toHaveBeenCalledWith(
        plugins,
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: expect.any(Number),
        }),
      );
    });
  });

  describe('updatePluginSettings', () => {
    it('should update settings for a given plugin', async () => {
      const pluginId = 'test-plugin';
      const newSettings = { setting1: 'new-value' };
      const refreshPlugins = vi.fn().mockResolvedValue(undefined);
      useToolStore.setState({ refreshPlugins, scopeGeneration: 7 });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        newSettings,
        expect.any(AbortSignal),
      );
      expect(refreshPlugins).toHaveBeenCalledWith(
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 7,
        }),
      );
    });

    it('should merge settings for a plugin with existing settings', async () => {
      const pluginId = 'test-plugin';
      const existingSettings = { setting1: 'old-value', setting2: 'old-value' };
      const newSettings = { setting1: 'new-value' };
      const mergedSettings = merge(existingSettings, newSettings);
      useToolStore.setState({
        installedPlugins: [{ identifier: pluginId, settings: existingSettings }] as LobeTool[],
      });

      const { result } = renderHook(() => useToolStore());

      await act(async () => {
        await result.current.updatePluginSettings(pluginId, newSettings);
      });

      expect(pluginService.updatePluginSettings).toBeCalledWith(
        pluginId,
        mergedSettings,
        expect.any(AbortSignal),
      );
    });

    it('updates an explicit identifier independently of the active selection', async () => {
      useToolStore.setState({ activePluginIdentifier: 'different-plugin' });

      await useToolStore.getState().updatePluginSettings('target-plugin', { enabled: true });

      expect(pluginService.updatePluginSettings).toHaveBeenCalledWith(
        'target-plugin',
        { enabled: true },
        expect.any(AbortSignal),
      );
    });

    it('does nothing on an active same-scope owner mismatch', async () => {
      const existingController = new AbortController();
      const abortSpy = vi.spyOn(existingController, 'abort');
      useToolStore.setState({ updatePluginSettingsSignal: existingController });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      await useToolStore.getState().updatePluginSettings('target-plugin', { enabled: true });

      expect(abortSpy).not.toHaveBeenCalled();
      expect(pluginService.updatePluginSettings).not.toHaveBeenCalled();
      expect(useToolStore.getState().updatePluginSettingsSignal).toBe(existingController);
    });

    it('does not clear newer account state after a stale settings completion', async () => {
      let resolveUpdate!: () => void;
      vi.mocked(pluginService.updatePluginSettings).mockReturnValue(
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
      );

      const updatePromise = useToolStore
        .getState()
        .updatePluginSettings('target-plugin', { enabled: true });
      const newerController = new AbortController();
      useUserStore.setState({ ownershipInvalidationGeneration: 1 });
      useToolStore.setState({
        scopeGeneration: useToolStore.getState().scopeGeneration + 1,
        updatePluginSettingsSignal: newerController,
      });

      resolveUpdate();
      await updatePromise;

      expect(useToolStore.getState().updatePluginSettingsSignal).toBe(newerController);
    });
  });

  describe('removeAllPlugins', () => {
    it('should reset all plugin settings', () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        result.current.removeAllPlugins();
      });

      expect(pluginService.removeAllPlugins).toBeCalled();
    });

    it('does not call the service during an active owner mismatch', async () => {
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      await useToolStore.getState().removeAllPlugins();

      expect(pluginService.removeAllPlugins).not.toHaveBeenCalled();
    });
  });

  describe('validatePluginSettings', () => {
    // 模拟插件数据
    const testPluginId = 'test-plugin';
    // 定义测试用的 schema 和模拟的验证结果
    const testSchema = {
      properties: { abc: { type: 'string' } },
      required: ['abc'],
      type: 'object',
    };

    const testPluginSettings = { abc: 'valid-string' };

    const testPlugin = {
      type: 'plugin',
      identifier: testPluginId,
      manifest: {
        identifier: testPluginId,
        settings: testSchema,
      },
      settings: testPluginSettings,
    } as unknown as LobeTool;

    it('should validate settings against the schema and return valid result', async () => {
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          installedPlugins: [testPlugin],
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toEqual({ valid: true, errors: [] });
    });

    it('should return invalid result if settings do not match the schema', async () => {
      const { result } = renderHook(() => useToolStore());
      act(() => {
        useToolStore.setState({
          installedPlugins: [{ ...testPlugin, settings: {} }] as any,
        });
      });

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toMatchSnapshot();
    });

    it('should return undefined if manifest or settings are not found', async () => {
      useToolStore.setState({
        installedPlugins: [],
      });

      const { result } = renderHook(() => useToolStore());

      const validationResult = await result.current.validatePluginSettings(testPluginId);

      expect(validationResult).toBeUndefined();
    });
  });
});
