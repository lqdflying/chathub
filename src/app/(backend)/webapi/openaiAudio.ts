import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, type ClientSecretPayload } from '@lobechat/types';
import OpenAI from 'openai';

import { getLLMConfig } from '@/envs/llm';

export const createOpenAIAudioClient = (
  payload: Pick<ClientSecretPayload, 'apiKey' | 'baseURL'>,
): OpenAI => {
  const { OPENAI_API_KEY } = getLLMConfig();
  const apiKey = payload.apiKey || OPENAI_API_KEY;

  if (!apiKey) {
    throw AgentRuntimeError.createError(ChatErrorType.NoOpenAIAPIKey);
  }

  return new OpenAI({
    apiKey,
    baseURL: payload.baseURL || process.env.OPENAI_PROXY_URL || undefined,
  });
};
