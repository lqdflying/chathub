import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';
import { useEffect } from 'react';

export const useOnPluginStateUpdate = (callback: (key: string, value: any) => void) => {
  useEffect(() => {
    const fn = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if (e.data.type === PluginChannel.updatePluginState) {
        const key = e.data.key;
        const value = e.data.value;

        callback(key, value);
      }
    };

    window.addEventListener('message', fn);
    return () => {
      window.removeEventListener('message', fn);
    };
  }, []);
};
