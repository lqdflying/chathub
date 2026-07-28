import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, type ClientSecretPayload } from '@lobechat/types';
import OpenAI from 'openai';

import { getLLMConfig } from '@/envs/llm';

export const createOpenAIAudioClient = (
  payload: Pick<ClientSecretPayload, 'apiKey' | 'baseURL'>,
): OpenAI => {
  const { OPENAI_API_KEY } = getLLMConfig();
  const clientApiKey = payload.apiKey;
  const apiKey = clientApiKey || OPENAI_API_KEY;

  if (!apiKey) {
    throw AgentRuntimeError.createError(ChatErrorType.NoOpenAIAPIKey);
  }

  return new OpenAI({
    apiKey,
    baseURL:
      (clientApiKey ? payload.baseURL : undefined) || process.env.OPENAI_PROXY_URL || undefined,
  });
};
