import type { ClientSecretPayload } from '@lobechat/types';
import {
  describeXaiOAuthErrorClass,
  logXaiOAuthDebugSafe,
  XAI_OAUTH_AUTH_MODE,
  XAI_OAUTH_BASE_URL,
} from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';

import type { LobeChatDatabase } from '@lobechat/database';

import { XaiOAuthService } from './oauth';
import type { XaiOAuthLiveSession, XaiOAuthRuntimePurpose } from './types';

export const isXaiOAuthProvider = (provider?: string) => provider === ModelProvider.Xai;

export const resolveXaiOAuthLiveSession = async (
  db: LobeChatDatabase,
  userId?: string,
): Promise<XaiOAuthLiveSession | null> => {
  if (!userId) return null;
  const service = new XaiOAuthService(db);
  return service.resolveLiveSession(userId);
};

export const applyXaiOAuthChatPayload = (
  payload: ClientSecretPayload,
  session: XaiOAuthLiveSession,
): ClientSecretPayload => ({
  ...payload,
  apiKey: session.accessToken,
  authMode: XAI_OAUTH_AUTH_MODE,
  baseURL: XAI_OAUTH_BASE_URL,
});

export const resolveXaiOAuthChatPayload = async (
  db: LobeChatDatabase,
  provider: string,
  payload: ClientSecretPayload,
  options?: { purpose?: XaiOAuthRuntimePurpose },
): Promise<ClientSecretPayload> => {
  if (!isXaiOAuthProvider(provider)) return payload;
  if (options?.purpose === 'structured') {
    logXaiOAuthDebugSafe('resolve_overlay_settled', {
      outcome: 'skipped',
      reason: 'structured',
    });
    return payload;
  }

  try {
    const session = await resolveXaiOAuthLiveSession(db, payload.userId);
    if (!session) {
      logXaiOAuthDebugSafe('resolve_overlay_settled', { outcome: 'platform' });
      return payload;
    }

    logXaiOAuthDebugSafe('resolve_overlay_settled', { outcome: 'oauth' });
    return applyXaiOAuthChatPayload(payload, session);
  } catch (error) {
    logXaiOAuthDebugSafe('resolve_overlay_settled', {
      errorClass: describeXaiOAuthErrorClass(error),
      outcome: 'error',
    });
    throw error;
  }
};
