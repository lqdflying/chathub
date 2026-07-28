import { ModelProvider } from 'model-bank';

import { createHeaderWithAuthSync } from './_auth';

/**
 * TODO: Need to be removed after tts refactor
 * @deprecated
 */
// eslint-disable-next-line no-undef
export const createHeaderWithOpenAI = (header?: HeadersInit): HeadersInit => {
  return createHeaderWithAuthSync({ headers: header, provider: ModelProvider.OpenAI });
};
