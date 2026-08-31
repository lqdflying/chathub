import { LobeAnthropicAI } from './providers/anthropic';
import { LobeAnthropicCompatibleAI } from './providers/anthropiccompatible';
import { LobeAzureOpenAI } from './providers/azureOpenai';
import { LobeAzureAI } from './providers/azureai';
import { LobeDeepSeekAI } from './providers/deepseek';
import { LobeGoogleAI } from './providers/google';
import { LobeMimoAI } from './providers/mimo';
import { LobeMinimaxAI } from './providers/minimax';
import { LobeMoonshotAI } from './providers/moonshot';
import { LobeOpenAI } from './providers/openai';
import { LobeOpenAICompatibleAI } from './providers/openaicompatible';
import { LobeZhipuAI } from './providers/zhipu';

export const providerRuntimeMap = {
  anthropic: LobeAnthropicAI,
  anthropiccompatible: LobeAnthropicCompatibleAI,
  azure: LobeAzureOpenAI,
  azureai: LobeAzureAI,
  deepseek: LobeDeepSeekAI,
  google: LobeGoogleAI,
  mimo: LobeMimoAI,
  minimax: LobeMinimaxAI,
  moonshot: LobeMoonshotAI,
  openai: LobeOpenAI,
  openaicompatible: LobeOpenAICompatibleAI,
  zhipu: LobeZhipuAI,
};
