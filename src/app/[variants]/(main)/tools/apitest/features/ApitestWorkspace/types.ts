export type AuthType = 'apikey' | 'basic' | 'bearer' | 'none';

export type ApiKeyLocation = 'header' | 'query';

export interface ApiTesterHeaderRow {
  enabled: boolean;
  id: string;
  key: string;
  value: string;
}

export interface QueryParamRow {
  enabled: boolean;
  id: string;
  key: string;
  value: string;
}

export interface ApiTesterRequestDraft {
  apiKeyLocation: ApiKeyLocation;
  apiKeyName: string;
  apiKeyValue: string;
  authType: AuthType;
  basicPassword: string;
  basicUsername: string;
  bearerToken: string;
  body: string;
  contentType: string;
  headers: ApiTesterHeaderRow[];
  method: string;
  url: string;
}

export interface ApiTesterProxyRequest {
  body?: string;
  headers?: Record<string, string>;
  method: string;
  url: string;
}

export interface ResponseState {
  body: string;
  error?: string;
  headers: Record<string, string>;
  isJson: boolean;
  size: number;
  status: number;
  statusText: string;
  time: number;
}

let rowIdSeed = 0;

export const createRowId = (): string => `row-${++rowIdSeed}`;

export const createHeaderRow = (key = '', value = ''): ApiTesterHeaderRow => ({
  enabled: true,
  id: createRowId(),
  key,
  value,
});

export const createParamRow = (key = '', value = ''): QueryParamRow => ({
  enabled: true,
  id: createRowId(),
  key,
  value,
});

export const createEmptyDraft = (): ApiTesterRequestDraft => ({
  apiKeyLocation: 'header',
  apiKeyName: 'X-Api-Key',
  apiKeyValue: '',
  authType: 'none',
  basicPassword: '',
  basicUsername: '',
  bearerToken: '',
  body: '',
  contentType: 'application/json',
  headers: [createHeaderRow()],
  method: 'GET',
  url: '',
});
