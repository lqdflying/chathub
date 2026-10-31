import type { ProviderUsageFetchContext } from './types';

export type UsageHttpResponse = {
  body: unknown;
  ok: boolean;
  status: number;
};

/**
 * One GET with a hard timeout. Never throws for HTTP errors; network errors
 * and timeouts propagate so the service can report a generic `error`.
 * The response body is never logged because vendors may echo account data.
 */
export const requestUsageJson = async (
  context: ProviderUsageFetchContext,
  url: string,
  headers: Record<string, string>,
): Promise<UsageHttpResponse> => {
  const response = await context.fetchFn(url, {
    headers: { Accept: 'application/json', ...headers },
    method: 'GET',
    signal: AbortSignal.timeout(context.timeoutMs),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { body, ok: response.ok, status: response.status };
};

export const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
