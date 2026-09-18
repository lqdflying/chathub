import { LobeChatDatabase } from '@lobechat/database';
import {
  OPENAI_AUTH_BASE_URL,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_DEVICE_CALLBACK_URL,
  OPENAI_CODEX_DEVICE_TIMEOUT_MS,
  OPENAI_CODEX_DEVICE_VERIFICATION_URL,
  OPENAI_CODEX_HANDOFF_CLIENT,
  OPENAI_CODEX_REFRESH_SKEW_MS,
  OPENAI_CODEX_USER_AGENT,
} from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import {
  NewOpenAICodexOAuthTokenItem,
  openaiCodexOAuthTokens,
} from '@/database/schemas/openaiCodexOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';
import { generateState } from '@/libs/mcp/pkce';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { resolveOpenAICodexJwtIdentity } from './jwt';
import type {
  OpenAICodexConnectionStatus,
  OpenAICodexDeviceLoginPoll,
  OpenAICodexDeviceLoginStart,
  OpenAICodexLiveSession,
} from './types';

type FetchFn = typeof fetch;

type TokenCrypto = {
  decrypt: (value: string) => Promise<{ plaintext: string; wasAuthentic: boolean }>;
  encrypt: (value: string) => Promise<string>;
};

type DeviceAuthHandoffPayload = {
  deviceAuthId: string;
  expiresAt: number;
  userCode: string;
  userId: string;
};

const jsonHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': OPENAI_CODEX_USER_AGENT,
};

const formHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': OPENAI_CODEX_USER_AGENT,
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
};

const computeExpiresAt = (expiresIn?: number, accessToken?: string): Date => {
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000);
  }

  if (accessToken) {
    const payload = resolveOpenAICodexJwtIdentity(accessToken);
    if (payload) {
      const jwt = JSON.parse(
        Buffer.from(accessToken.split('.')[1] || '', 'base64url').toString('utf8') || '{}',
      ) as { exp?: number };
      if (typeof jwt.exp === 'number' && jwt.exp > 0) {
        return new Date(jwt.exp * 1000);
      }
    }
  }

  return new Date(Date.now() + 60 * 60 * 1000);
};

const sanitizeStatus = (session: {
  chatgptPlanType?: string | null;
  email?: string | null;
  expiresAt: Date;
}): OpenAICodexConnectionStatus => ({
  chatgptPlanType: session.chatgptPlanType || undefined,
  connected: true,
  email: session.email || undefined,
  expiresAt: session.expiresAt.toISOString(),
});

export class OpenAICodexOAuthService {
  private readonly db: LobeChatDatabase;
  private readonly fetchFn: FetchFn;
  private crypto?: TokenCrypto;

  constructor(
    db: LobeChatDatabase,
    options?: {
      crypto?: TokenCrypto;
      fetchFn?: FetchFn;
    },
  ) {
    this.db = db;
    this.fetchFn = options?.fetchFn ?? fetch;
    this.crypto = options?.crypto;
  }

  private async getCrypto(): Promise<TokenCrypto> {
    if (this.crypto) return this.crypto;
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    this.crypto = {
      decrypt: (value) => gateKeeper.decrypt(value),
      encrypt: (value) => gateKeeper.encrypt(value),
    };
    return this.crypto;
  }

  async startDeviceLogin(userId: string): Promise<OpenAICodexDeviceLoginStart> {
    const response = await this.fetchFn(`${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
      body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
      headers: jsonHeaders,
      method: 'POST',
    });
    const bodyText = await response.text();
    const body = parseJsonObject(bodyText);
    const deviceAuthId = asOptionalString(body.device_auth_id);
    const userCode = asOptionalString(body.user_code);
    const verificationUrl =
      asOptionalString(body.verification_uri) ||
      asOptionalString(body.verification_url) ||
      OPENAI_CODEX_DEVICE_VERIFICATION_URL;

    if (!response.ok || !deviceAuthId || !userCode) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `OpenAI device authorization failed (HTTP ${response.status}).`,
      });
    }

    const handoffId = generateState();
    const expiresAt = Date.now() + OPENAI_CODEX_DEVICE_TIMEOUT_MS;
    const payload: DeviceAuthHandoffPayload = {
      deviceAuthId,
      expiresAt,
      userCode,
      userId,
    };

    await this.db.insert(oauthHandoffs).values({
      client: OPENAI_CODEX_HANDOFF_CLIENT,
      id: handoffId,
      payload,
    });

    return {
      expiresAt: new Date(expiresAt).toISOString(),
      handoffId,
      userCode,
      verificationUrl,
    };
  }

  async pollDeviceLogin(userId: string, handoffId: string): Promise<OpenAICodexDeviceLoginPoll> {
    const [handoff] = await this.db
      .select()
      .from(oauthHandoffs)
      .where(eq(oauthHandoffs.id, handoffId));

    if (!handoff || handoff.client !== OPENAI_CODEX_HANDOFF_CLIENT) {
      return { status: 'expired' };
    }

    const payload = handoff.payload as DeviceAuthHandoffPayload;
    if (payload.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Device login does not belong to this user.' });
    }

    if (payload.expiresAt <= Date.now()) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      return { status: 'expired' };
    }

    const tokenResponse = await this.fetchFn(
      `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/token`,
      {
        body: JSON.stringify({
          device_auth_id: payload.deviceAuthId,
          user_code: payload.userCode,
        }),
        headers: jsonHeaders,
        method: 'POST',
      },
    );
    const tokenText = await tokenResponse.text();
    const tokenBody = parseJsonObject(tokenText);
    const authorizationCode = asOptionalString(tokenBody.authorization_code);
    const codeVerifier = asOptionalString(tokenBody.code_verifier);

    if (tokenResponse.status === 403 || tokenResponse.status === 428 || !authorizationCode) {
      const error = asOptionalString(tokenBody.error);
      if (error === 'access_denied' || error === 'expired_token') {
        await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
        return { message: error, status: 'denied' };
      }
      return { status: 'pending' };
    }

    if (!codeVerifier) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      return { message: 'missing_code_verifier', status: 'denied' };
    }

    const exchanged = await this.exchangeAuthorizationCode(authorizationCode, codeVerifier);
    if (!exchanged) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      return { message: 'token_exchange_failed', status: 'denied' };
    }

    const stored = await this.persistTokens(userId, exchanged);
    await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));

    return { ...sanitizeStatus(stored), status: 'connected' };
  }

  async getStatus(userId: string): Promise<OpenAICodexConnectionStatus> {
    const [record] = await this.db
      .select({
        chatgptPlanType: openaiCodexOAuthTokens.chatgptPlanType,
        email: openaiCodexOAuthTokens.email,
        expiresAt: openaiCodexOAuthTokens.expiresAt,
      })
      .from(openaiCodexOAuthTokens)
      .where(eq(openaiCodexOAuthTokens.userId, userId));

    if (!record) return { connected: false };

    return sanitizeStatus(record);
  }

  async logout(userId: string): Promise<void> {
    await this.db.delete(openaiCodexOAuthTokens).where(eq(openaiCodexOAuthTokens.userId, userId));
  }

  async resolveLiveSession(userId: string): Promise<OpenAICodexLiveSession | null> {
    const [record] = await this.db
      .select()
      .from(openaiCodexOAuthTokens)
      .where(eq(openaiCodexOAuthTokens.userId, userId));

    if (!record) return null;

    const crypto = await this.getCrypto();
    const access = await crypto.decrypt(record.accessToken);
    const refresh = await crypto.decrypt(record.refreshToken);
    if (!access.wasAuthentic || !refresh.wasAuthentic || !access.plaintext || !refresh.plaintext) {
      await this.logout(userId);
      return null;
    }

    const needsRefresh = record.expiresAt.getTime() - Date.now() <= OPENAI_CODEX_REFRESH_SKEW_MS;
    if (!needsRefresh) {
      return {
        accessToken: access.plaintext,
        accountId: record.accountId,
        chatgptPlanType: record.chatgptPlanType || undefined,
        email: record.email || undefined,
        expiresAt: record.expiresAt,
      };
    }

    const refreshed = await this.refreshAccessToken(refresh.plaintext);
    if (!refreshed) {
      await this.logout(userId);
      return null;
    }

    const stored = await this.persistTokens(userId, refreshed);
    return {
      accessToken: refreshed.accessToken,
      accountId: stored.accountId,
      chatgptPlanType: stored.chatgptPlanType || undefined,
      email: stored.email || undefined,
      expiresAt: stored.expiresAt,
    };
  }

  private async exchangeAuthorizationCode(
    authorizationCode: string,
    codeVerifier: string,
  ): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string } | null> {
    const response = await this.fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
      body: new URLSearchParams({
        client_id: OPENAI_CODEX_CLIENT_ID,
        code: authorizationCode,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: OPENAI_CODEX_DEVICE_CALLBACK_URL,
      }),
      headers: formHeaders,
      method: 'POST',
    });
    const body = parseJsonObject(await response.text());
    const accessToken = asOptionalString(body.access_token);
    const refreshToken = asOptionalString(body.refresh_token);
    if (!response.ok || !accessToken || !refreshToken) return null;

    return {
      accessToken,
      expiresAt: computeExpiresAt(
        typeof body.expires_in === 'number' ? body.expires_in : undefined,
        accessToken,
      ),
      refreshToken,
    };
  }

  private async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string } | null> {
    const response = await this.fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
      body: new URLSearchParams({
        client_id: OPENAI_CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      headers: formHeaders,
      method: 'POST',
    });
    const body = parseJsonObject(await response.text());
    const error = asOptionalString(body.error);
    if (
      !response.ok ||
      error === 'invalid_grant' ||
      error === 'invalid_refresh_token' ||
      error === 'refresh_token_reused'
    ) {
      return null;
    }

    const accessToken = asOptionalString(body.access_token);
    if (!accessToken) return null;

    return {
      accessToken,
      expiresAt: computeExpiresAt(
        typeof body.expires_in === 'number' ? body.expires_in : undefined,
        accessToken,
      ),
      refreshToken: asOptionalString(body.refresh_token) || refreshToken,
    };
  }

  private async persistTokens(
    userId: string,
    tokens: { accessToken: string; expiresAt: Date; refreshToken: string },
  ) {
    const identity = resolveOpenAICodexJwtIdentity(tokens.accessToken);
    if (!identity?.accountId) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'OpenAI token did not include a ChatGPT account id.',
      });
    }

    const crypto = await this.getCrypto();
    const [accessToken, refreshToken] = await Promise.all([
      crypto.encrypt(tokens.accessToken),
      crypto.encrypt(tokens.refreshToken),
    ]);

    const insert: NewOpenAICodexOAuthTokenItem = {
      accessToken,
      accountId: identity.accountId,
      chatgptPlanType: identity.chatgptPlanType,
      clientId: OPENAI_CODEX_CLIENT_ID,
      email: identity.email,
      expiresAt: tokens.expiresAt,
      refreshToken,
      userId,
    };

    await this.db
      .delete(openaiCodexOAuthTokens)
      .where(eq(openaiCodexOAuthTokens.userId, userId));
    await this.db.insert(openaiCodexOAuthTokens).values(insert);

    return {
      accountId: identity.accountId,
      chatgptPlanType: identity.chatgptPlanType,
      email: identity.email,
      expiresAt: tokens.expiresAt,
    };
  }
}
