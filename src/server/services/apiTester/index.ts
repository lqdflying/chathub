import { ssrfSafeFetch } from 'ssrf-safe-fetch';
import { z } from 'zod';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const BODY_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

const HeaderRecordSchema = z.record(z.string(), z.string());

export const ApiTesterRequestSchema = z.object({
  body: z.string().optional(),
  headers: HeaderRecordSchema.optional(),
  method: z.enum(HTTP_METHODS),
  url: z.string().url(),
});

export type ApiTesterRequest = z.infer<typeof ApiTesterRequestSchema>;

export interface ApiTesterResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}

interface ExecuteApiTesterRequestOptions {
  signal?: AbortSignal;
}

export const executeApiTesterRequest = async (
  request: ApiTesterRequest,
  options: ExecuteApiTesterRequestOptions = {},
): Promise<ApiTesterResponse> => {
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }

  const hasBody = BODY_METHODS.has(request.method);
  const fetchOptions: RequestInit = {
    body: hasBody && request.body ? request.body : undefined,
    headers: request.headers,
    method: request.method,
  };

  if (options.signal) fetchOptions.signal = options.signal;

  const response = await ssrfSafeFetch(request.url, fetchOptions);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    body: await response.text(),
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  };
};
