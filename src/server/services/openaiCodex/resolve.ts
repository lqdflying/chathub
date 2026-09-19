import type { ClientSecretPayload } from '@lobechat/types';
import {
  describeOpenAICodexErrorClass,
  logOpenAICodexDebugSafe,
  OPENAI_CODEX_AUTH_MODE,
  OPENAI_CODEX_BASE_URL,
} from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';

import type { LobeChatDatabase } from '@lobechat/database';

import { OpenAICodexOAuthService } from './oauth';
import type { ConversationRuntimePurpose, OpenAICodexLiveSession } from './types';

export const isOpenAICodexProvider = (provider?: string) => provider === ModelProvider.OpenAI;

export const resolveOpenAICodexLiveSession = async (
  db: LobeChatDatabase,
  userId?: string,
): Promise<OpenAICodexLiveSession | null> => {
  if (!userId) return null;
  const service = new OpenAICodexOAuthService(db);
  return service.resolveLiveSession(userId);
};

export const applyOpenAICodexChatPayload = (
  payload: ClientSecretPayload,
  session: OpenAICodexLiveSession,
): ClientSecretPayload => ({
  ...payload,
  accountId: session.accountId,
  apiKey: session.accessToken,
  authMode: OPENAI_CODEX_AUTH_MODE,
  baseURL: OPENAI_CODEX_BASE_URL,
});

export const resolveOpenAICodexChatPayload = async (
  db: LobeChatDatabase,
  provider: string,
  payload: ClientSecretPayload,
  options?: { purpose?: ConversationRuntimePurpose },
): Promise<ClientSecretPayload> => {
  if (!isOpenAICodexProvider(provider)) return payload;
  if (options?.purpose === 'structured') {
    logOpenAICodexDebugSafe('resolve_overlay_settled', {
      outcome: 'skipped',
      reason: 'structured',
    });
    return payload;
  }

  try {
    const session = await resolveOpenAICodexLiveSession(db, payload.userId);
    if (!session) {
      logOpenAICodexDebugSafe('resolve_overlay_settled', { outcome: 'platform' });
      return payload;
    }

    logOpenAICodexDebugSafe('resolve_overlay_settled', {
      hasAccountId: true,
      outcome: 'codex',
    });
    return applyOpenAICodexChatPayload(payload, session);
  } catch (error) {
    logOpenAICodexDebugSafe('resolve_overlay_settled', {
      errorClass: describeOpenAICodexErrorClass(error),
      outcome: 'error',
    });
    throw error;
  }
};
