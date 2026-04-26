import { LobeAnthropicAI } from './providers/anthropic';
import { LobeAzureOpenAI } from './providers/azureOpenai';
import { LobeAzureAI } from './providers/azureai';
import { LobeDeepSeekAI } from './providers/deepseek';
import { LobeGoogleAI } from './providers/google';
import { LobeMinimaxAI } from './providers/minimax';
import { LobeMoonshotAI } from './providers/moonshot';
import { LobeOpenAI } from './providers/openai';
import { LobeOpenAICompatibleAI } from './providers/openaicompatible';

export const providerRuntimeMap = {
  anthropic: LobeAnthropicAI,
  azure: LobeAzureOpenAI,
  azureai: LobeAzureAI,
  deepseek: LobeDeepSeekAI,
  google: LobeGoogleAI,
  minimax: LobeMinimaxAI,
  moonshot: LobeMoonshotAI,
  openai: LobeOpenAI,
  openaicompatible: LobeOpenAICompatibleAI,
};
