import { type ApiTesterRequestDraft } from './types';

export interface ApiTesterHistoryEntry {
  createdAt: number;
  id: string;
  request: ApiTesterRequestDraft;
  response?: {
    size: number;
    status: number;
    time: number;
  };
}

export const HISTORY_LIMIT = 50;

export const HISTORY_STORAGE_KEY = 'apitest-history';

/**
 * Prepends an entry and caps the list at `limit` items. Pure.
 */
export const appendHistoryEntry = (
  entries: ApiTesterHistoryEntry[],
  entry: ApiTesterHistoryEntry,
  limit: number = HISTORY_LIMIT,
): ApiTesterHistoryEntry[] => {
  return [entry, ...entries].slice(0, limit);
};

const isValidEntry = (entry: unknown): entry is ApiTesterHistoryEntry => {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<ApiTesterHistoryEntry>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.createdAt === 'number' &&
    !!candidate.request &&
    typeof candidate.request === 'object' &&
    typeof candidate.request.method === 'string' &&
    typeof candidate.request.url === 'string' &&
    Array.isArray(candidate.request.headers)
  );
};

/**
 * Loads history from localStorage. Returns [] on any failure (missing key,
 * corrupt JSON, unexpected shape).
 */
export const loadHistory = (): ApiTesterHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => isValidEntry(entry)).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
};

/**
 * Persists history to localStorage. Note: entries include any auth secrets
 * typed into the builder — acceptable for a local dev tool, mirrored from the
 * in-memory draft the user already entered.
 */
export const saveHistory = (entries: ApiTesterHistoryEntry[]): void => {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable — history is best-effort
  }
};
