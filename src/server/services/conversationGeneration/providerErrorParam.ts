import { hashGenerationDebugValue } from '@/libs/logger/generationDebug';

/**
 * Xiaomi Token Plan (and similar OpenAI-compatible gateways) put the real 400
 * reason on nested `error.param` while `message` stays `Param Incorrect`.
 * Walk `.param` / `.error` / `.body` so UI folding and safe logs can use it.
 */
export const readProviderErrorParam = (error: unknown): string | undefined => {
  const visit = (value: unknown, depth: number): string | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.param === 'string' && record.param.trim()) {
      return record.param.trim().slice(0, 160);
    }
    return visit(record.error, depth + 1) ?? visit(record.body, depth + 1);
  };
  return visit(error, 0);
};

export type ProviderErrorParamClass =
  | 'web_search_disabled'
  | 'temperature_out_of_range'
  | 'other';

/**
 * Map a provider-controlled `error.param` string to a safe enum + fingerprint.
 * Raw param text can echo prompt or customer data and must not enter the
 * generation-debug safe channel.
 */
export const classifyProviderErrorParam = (
  param?: string,
): {
  errorParamClass?: ProviderErrorParamClass;
  errorParamHash?: string;
} => {
  if (!param?.trim()) return {};
  const value = param.trim();
  let errorParamClass: ProviderErrorParamClass = 'other';
  if (/webSearchEnabled is false/i.test(value)) errorParamClass = 'web_search_disabled';
  else if (/temperature must be within/i.test(value)) errorParamClass = 'temperature_out_of_range';

  return {
    errorParamClass,
    errorParamHash: hashGenerationDebugValue(value),
  };
};
