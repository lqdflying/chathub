import { Schema, ValidationResult } from '@cfworker/json-schema';
import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { useClientDataSWR } from '@/libs/swr';
import { pluginService } from '@/services/plugin';
import {
  captureToolMutationCheckpoint,
  isToolMutationCurrent,
} from '@/store/tool/mutation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';

import { ToolStore } from '../../store';
import { pluginStoreSelectors } from '../oldStore/selectors';
import { pluginSelectors } from './selectors';

/**
 * 插件接口
 */
export interface PluginAction {
  checkPluginsIsInstalled: (plugins: string[]) => Promise<void>;
  removeAllPlugins: () => Promise<void>;
  updateInstallMcpPlugin: (id: string, value: any) => Promise<void>;
  updatePluginSettings: <T>(
    id: string,
    settings: Partial<T>,
    options?: { override?: boolean },
  ) => Promise<void>;
  useCheckPluginsIsInstalled: (enable: boolean, plugins: string[]) => SWRResponse;
  validatePluginSettings: (identifier: string) => Promise<ValidationResult | undefined>;
}

export const createPluginSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  PluginAction
> = (set, get) => ({
  checkPluginsIsInstalled: async (plugins) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    // if there is no plugins, just skip.
    if (plugins.length === 0) return;

    const { loadPluginStore, installPlugins } = get();

    // check if the store is empty
    // if it is, we need to load the plugin store
    if (pluginStoreSelectors.onlinePluginStore(get()).length === 0) {
      if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
      await loadPluginStore(checkpoint);
      if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    }

    await installPlugins(plugins, checkpoint);
  },
  removeAllPlugins: async () => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await pluginService.removeAllPlugins();
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
  },

  updateInstallMcpPlugin: async (id, value) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const installedPlugin = pluginSelectors.getInstalledPluginById(id)(get());

    if (!installedPlugin) return;

    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    await pluginService.updatePlugin(id, {
      customParams: { mcp: merge(installedPlugin.customParams?.mcp, value) },
    });
    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    await get().refreshPlugins(checkpoint);
  },

  updatePluginSettings: async (id, settings, { override } = {}) => {
    const checkpoint = captureToolMutationCheckpoint(get().scopeGeneration);
    if (!checkpoint || !isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

    const signal = get().updatePluginSettingsSignal;
    if (signal) signal.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = new AbortController();

    const previousSettings = pluginSelectors.getPluginSettingsById(id)(get());
    const nextSettings = override ? settings : merge(previousSettings, settings);

    if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;
    set({ updatePluginSettingsSignal: newSignal }, false, 'create new Signal');
    try {
      if (
        newSignal.signal.aborted ||
        !isToolMutationCurrent(checkpoint, get().scopeGeneration)
      )
        return;

      await pluginService.updatePluginSettings(id, nextSettings, newSignal.signal);
      if (newSignal.signal.aborted) return;
      if (!isToolMutationCurrent(checkpoint, get().scopeGeneration)) return;

      await get().refreshPlugins(checkpoint);
    } finally {
      if (
        get().updatePluginSettingsSignal === newSignal &&
        isToolMutationCurrent(checkpoint, get().scopeGeneration)
      ) {
        set({ updatePluginSettingsSignal: undefined }, false, 'clear update settings Signal');
      }
    }
  },
  useCheckPluginsIsInstalled: (enable, plugins) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      enable && requestedScope ? ['checkPluginsIsInstalled', requestedScope, ...plugins] : null,
      async () => {
        await get().checkPluginsIsInstalled(plugins);
      },
    );
  },
  validatePluginSettings: async (identifier) => {
    const manifest = pluginSelectors.getToolManifestById(identifier)(get());
    if (!manifest || !manifest.settings) return;
    const settings = pluginSelectors.getPluginSettingsById(identifier)(get());

    // validate the settings
    const { Validator } = await import('@cfworker/json-schema');
    const validator = new Validator(manifest.settings as Schema);
    const result = validator.validate(settings);

    if (!result.valid) return { errors: result.errors, valid: false };

    return { errors: [], valid: true };
  },
});
