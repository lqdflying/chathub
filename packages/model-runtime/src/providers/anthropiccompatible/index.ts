import type { ClientOptions } from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import { LobeAnthropicAI } from '../anthropic';

interface AnthropicCompatibleAIParams extends ClientOptions {
  authMode?: 'api-key' | 'bearer';
  id?: string;
}

const defaultBaseURL =
  process.env.ANTHROPICCOMPATIBLE_PROXY_URL?.trim() || 'https://api.anthropic.com';

export class LobeAnthropicCompatibleAI extends LobeAnthropicAI {
  constructor({ authMode, ...params }: AnthropicCompatibleAIParams = {}) {
    const resolvedAuthMode =
      authMode || (process.env.ANTHROPICCOMPATIBLE_AUTH_MODE as 'api-key' | 'bearer') || 'api-key';

    const sdkParams =
      resolvedAuthMode === 'bearer'
        ? { ...params, apiKey: undefined, authToken: params.apiKey }
        : params;

    super({
      baseURL: defaultBaseURL,
      ...sdkParams,
      id: ModelProvider.AnthropicCompatible,
    });
  }
}
