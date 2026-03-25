import { LobeAnthropicAI } from './providers/anthropic';
import { LobeAzureOpenAI } from './providers/azureOpenai';
import { LobeAzureAI } from './providers/azureai';
import { LobeGoogleAI } from './providers/google';
import { LobeMinimaxAI } from './providers/minimax';
import { LobeOpenAI } from './providers/openai';

export const providerRuntimeMap = {
  anthropic: LobeAnthropicAI,
  azure: LobeAzureOpenAI,
  azureai: LobeAzureAI,
  google: LobeGoogleAI,
  minimax: LobeMinimaxAI,
  openai: LobeOpenAI,
};
