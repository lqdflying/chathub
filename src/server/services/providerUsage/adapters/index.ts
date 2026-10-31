import type { ProviderUsageAdapter } from '../types';
import { anthropicUsageAdapter } from './anthropic';
import { deepseekUsageAdapter } from './deepseek';
import { minimaxUsageAdapter } from './minimax';
import { moonshotUsageAdapter } from './moonshot';
import { openaiUsageAdapter } from './openai';
import { xaiUsageAdapter } from './xai';
import { zhipuUsageAdapter } from './zhipu';

const ADAPTERS: ProviderUsageAdapter[] = [
  anthropicUsageAdapter,
  deepseekUsageAdapter,
  minimaxUsageAdapter,
  moonshotUsageAdapter,
  openaiUsageAdapter,
  xaiUsageAdapter,
  zhipuUsageAdapter,
];

const ADAPTER_MAP = new Map(ADAPTERS.map((adapter) => [adapter.provider, adapter]));

export const getProviderUsageAdapter = (provider: string) => ADAPTER_MAP.get(provider);
