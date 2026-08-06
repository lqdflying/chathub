'use client';

import { setChunkableFileCapabilities } from '@lobechat/utils';
import { ReactNode, memo } from 'react';

import { IFeatureFlags, mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { GlobalServerConfig } from '@/types/serverConfig';

import { Provider, createServerConfigStore } from './store';

interface GlobalStoreProviderProps {
  children: ReactNode;
  featureFlags?: Partial<IFeatureFlags>;
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig?: GlobalServerConfig;
}

export const ServerConfigStoreProvider = memo<GlobalStoreProviderProps>(
  ({ children, featureFlags, serverConfig, isMobile, segmentVariants }) => (
    <Provider
      createStore={() => {
        // `isChunkableFile` is a pure helper shared by the upload UI, the store
        // and the server. On the server it reads the environment directly; the
        // browser has no access to it, so hydrate the capability here — before
        // any component asks which formats the Knowledge Base accepts.
        setChunkableFileCapabilities({ markitdown: !!serverConfig?.enabledMarkItDown });

        return createServerConfigStore({
          featureFlags: featureFlags ? mapFeatureFlagsEnvToState(featureFlags) : undefined,
          isMobile,
          segmentVariants,
          serverConfig,
        });
      }}
    >
      {children}
    </Provider>
  ),
);
