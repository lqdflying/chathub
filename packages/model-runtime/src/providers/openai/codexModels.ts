import { processMultiProviderModelList } from '../../utils/modelParse';
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_CLIENT_VERSION,
  OPENAI_CODEX_ORIGINATOR,
  OPENAI_CODEX_USER_AGENT,
} from './codexConstants';

export const OPENAI_CODEX_FALLBACK_MODEL_IDS = [
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2',
  'o3',
  'o4-mini',
] as const;

type CodexModelRef = { id: string };

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const buildCodexModelsUrl = (
  baseURL = OPENAI_CODEX_BASE_URL,
  clientVersion = OPENAI_CODEX_CLIENT_VERSION,
) => {
  const normalized = baseURL.replace(/\/+$/, '');
  const root = normalized.endsWith('/codex') ? normalized : `${normalized}/codex`;
  return `${root}/models?client_version=${encodeURIComponent(clientVersion)}`;
};

export const buildCodexModelsHeaders = ({
  accessToken,
  accountId,
}: {
  accessToken: string;
  accountId: string;
}): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  'User-Agent': OPENAI_CODEX_USER_AGENT,
  'chatgpt-account-id': accountId,
  originator: OPENAI_CODEX_ORIGINATOR,
});

export const normalizeCodexModelList = (json: unknown): CodexModelRef[] => {
  const record = asRecord(json);
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(json)
        ? json
        : [];

  return list
    .map((item): CodexModelRef | null => {
      if (typeof item === 'string' && item.trim()) return { id: item.trim() };
      const row = asRecord(item);
      const id =
        (typeof row.id === 'string' && row.id.trim()) ||
        (typeof row.slug === 'string' && row.slug.trim()) ||
        '';
      return id ? { id } : null;
    })
    .filter((item): item is CodexModelRef => !!item);
};

export const getOpenAICodexFallbackModels = async () =>
  processMultiProviderModelList(
    OPENAI_CODEX_FALLBACK_MODEL_IDS.map((id) => ({ id })),
    'openai',
  );

export const fetchOpenAICodexModels = async ({
  accessToken,
  accountId,
  fetchFn = fetch,
}: {
  accessToken: string;
  accountId: string;
  fetchFn?: typeof fetch;
}) => {
  try {
    const response = await fetchFn(buildCodexModelsUrl(), {
      headers: buildCodexModelsHeaders({ accessToken, accountId }),
      method: 'GET',
    });
    if (!response.ok) return getOpenAICodexFallbackModels();

    const models = normalizeCodexModelList(await response.json());
    if (models.length === 0) return getOpenAICodexFallbackModels();

    return processMultiProviderModelList(models, 'openai');
  } catch {
    return getOpenAICodexFallbackModels();
  }
};
