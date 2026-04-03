import { PluginChannel } from '@lobehub/chat-plugin-sdk/client';

/**
 * Derive the target origin from a URL string.
 * Falls back to '*' only when the URL is invalid or empty.
 * Callers should always pass the iframe src so messages are scoped
 * to the exact plugin origin rather than any origin ('*').
 */
export const getTargetOrigin = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return '*';
  }
};

export const sendMessageContentToPlugin = (window: Window, props: any, targetOrigin: string) => {
  window.postMessage({ props, type: PluginChannel.renderPlugin }, targetOrigin);
};

export const sendPayloadToPlugin = (
  window: Window,
  props: { payload: any; settings: any; state?: any },
  targetOrigin: string,
) => {
  window.postMessage(
    {
      type: PluginChannel.initStandalonePlugin,
      ...props,
      // TODO: props need to deprecated
      props: props.payload,
    },
    targetOrigin,
  );
};

export const sendPluginStateToPlugin = (
  window: Window,
  key: string,
  value: any,
  targetOrigin: string,
) => {
  window.postMessage({ key, type: PluginChannel.renderPluginState, value }, targetOrigin);
};

export const sendPluginSettingsToPlugin = (
  window: Window,
  settings: any,
  targetOrigin: string,
) => {
  window.postMessage({ type: PluginChannel.renderPluginSettings, value: settings }, targetOrigin);
};
