import type { ProviderUsageAdapter } from '../types';
import { deepseekUsageAdapter } from './deepseek';
import { minimaxUsageAdapter } from './minimax';
import { moonshotUsageAdapter } from './moonshot';
import { zhipuUsageAdapter } from './zhipu';

const ADAPTERS: ProviderUsageAdapter[] = [
  deepseekUsageAdapter,
  minimaxUsageAdapter,
  moonshotUsageAdapter,
  zhipuUsageAdapter,
];

const ADAPTER_MAP = new Map(ADAPTERS.map((adapter) => [adapter.provider, adapter]));

export const getProviderUsageAdapter = (provider: string) => ADAPTER_MAP.get(provider);
