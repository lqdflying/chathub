import type { ClientOptions } from '@anthropic-ai/sdk';
import { ModelProvider } from 'model-bank';

import { LobeAnthropicAI } from '../anthropic';

interface AnthropicCompatibleAIParams extends ClientOptions {
  id?: string;
}

const defaultBaseURL =
  process.env.ANTHROPICCOMPATIBLE_PROXY_URL?.trim() || 'https://api.anthropic.com';

export class LobeAnthropicCompatibleAI extends LobeAnthropicAI {
  constructor(params: AnthropicCompatibleAIParams = {}) {
    super({
      baseURL: defaultBaseURL,
      ...params,
      id: ModelProvider.AnthropicCompatible,
    });
  }
}
