'use client';

import { ForwardedRef, memo, useImperativeHandle } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { AgentSettingsInstance, useAgentSettings } from './hooks/useAgentSettings';
import { State, useStoreApi } from './store';

export interface StoreUpdaterProps
  extends Partial<
    Pick<
      State,
      'onMetaChange' | 'onConfigChange' | 'onRefreshConfig' | 'meta' | 'config' | 'id' | 'loading'
    >
  > {
  instanceRef?: ForwardedRef<AgentSettingsInstance> | null;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({ onConfigChange, onRefreshConfig, instanceRef, id, onMetaChange, meta, config, loading }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    useStoreUpdater('meta', meta!);
    useStoreUpdater('config', config!);
    useStoreUpdater('onConfigChange', onConfigChange);
    useStoreUpdater('onRefreshConfig', onRefreshConfig);
    useStoreUpdater('onMetaChange', onMetaChange);
    useStoreUpdater('loading', loading);
    useStoreUpdater('id', id);

    const instance = useAgentSettings();
    useImperativeHandle(instanceRef, () => instance);

    return null;
  },
);

export default StoreUpdater;
