import debug from 'debug';

import { ChatMethodOptions } from '../types/chat';

const log = debug('model-runtime:helpers:mergeChatMethodOptions');

export const mergeMultipleChatMethodOptions = (options: ChatMethodOptions[]): ChatMethodOptions => {
  let completionOptions: ChatMethodOptions = {};
  completionOptions.callback = {
    onCancel: async (reason) => {
      for (const option of options) {
        if (option.callback?.onCancel) {
          try {
            await option.callback.onCancel(reason);
          } catch (error) {
            log('onCancel callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onCompletion: async (data) => {
      for (const option of options) {
        if (option.callback?.onCompletion) {
          try {
            await option.callback.onCompletion(data);
          } catch (error) {
            log('onCompletion callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onError: async (errorData) => {
      for (const option of options) {
        if (option.callback?.onError) {
          try {
            await option.callback.onError(errorData);
          } catch (error) {
            log('onError callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onFinal: async (data) => {
      for (const option of options) {
        if (option.callback?.onFinal) {
          try {
            await option.callback.onFinal(data);
          } catch (error) {
            log('onFinal callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onGrounding: async (data) => {
      for (const option of options) {
        if (option.callback?.onGrounding) {
          try {
            await option.callback.onGrounding(data);
          } catch (error) {
            log('onGrounding callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onStart: async () => {
      for (const option of options) {
        if (option.callback?.onStart) {
          try {
            await option.callback.onStart();
          } catch (error) {
            log('onStart callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onText: async (data) => {
      for (const option of options) {
        if (option.callback?.onText) {
          try {
            await option.callback.onText(data);
          } catch (error) {
            log('onText callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onThinking: async (data) => {
      for (const option of options) {
        if (option.callback?.onThinking) {
          try {
            await option.callback.onThinking(data);
          } catch (error) {
            log('onThinking callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onToolsCalling: async (data) => {
      for (const option of options) {
        if (option.callback?.onToolsCalling) {
          try {
            await option.callback.onToolsCalling(data);
          } catch (error) {
            log('onToolsCalling callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
    onUsage: async (data) => {
      for (const option of options) {
        if (option.callback?.onUsage) {
          try {
            await option.callback.onUsage(data);
          } catch (error) {
            log('onUsage callback error:');
            log(JSON.stringify(error));
          }
        }
      }
    },
  };
  completionOptions.headers = options.reduce((acc, option) => {
    if (option)
      return {
        ...acc,
        ...option.headers,
      };
    return acc;
  }, {});
  completionOptions.requestHeaders = options.reduce((acc, option) => {
    if (option)
      return {
        ...acc,
        ...option.requestHeaders,
      };
    return acc;
  }, {});
  return completionOptions;
};
