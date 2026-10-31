import type { ProviderUsageAdapter } from '../types';
import { deepseekUsageAdapter } from './deepseek';
import { moonshotUsageAdapter } from './moonshot';

const ADAPTERS: ProviderUsageAdapter[] = [deepseekUsageAdapter, moonshotUsageAdapter];

const ADAPTER_MAP = new Map(ADAPTERS.map((adapter) => [adapter.provider, adapter]));

export const getProviderUsageAdapter = (provider: string) => ADAPTER_MAP.get(provider);
