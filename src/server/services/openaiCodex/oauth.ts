import { randomUUID } from 'node:crypto';

import { LobeChatDatabase } from '@lobechat/database';
import {
  OPENAI_AUTH_BASE_URL,
  describeOpenAICodexErrorClass,
  logOpenAICodexDebugSafe,
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
} from '@/database/schemas/openaiCodexOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';
import { generateState } from '@/libs/mcp/pkce';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { OpenAICodexTransientRefreshError } from './errors';
import { resolveOpenAICodexJwtIdentity } from './jwt';
import {
  createDrizzleOpenAICodexTokenStore,
  type OpenAICodexTokenStore,
} from './tokenStore';
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

type RefreshOutcome =
  | { tokens: { accessToken: string; expiresAt: Date; refreshToken: string }; type: 'success' }
  | { type: 'invalid' }
  | { status: number; type: 'transient' };

// Wall-clock TTL is only a liveness hint. A held refreshLockId is exclusive
// until that owner persists or releases; expiry must not authorize another redeem.
const OPENAI_CODEX_REFRESH_LOCK_TTL_MS = 30_000;

const userLocks = new Map<string, Promise<unknown>>();

export const withOpenAICodexUserLock = async <T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  userLocks.set(
    userId,
    previous.then(
      () => current,
      () => current,
    ),
  );
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (userLocks.get(userId) === current) userLocks.delete(userId);
  }
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

const toLiveSession = (
  accessToken: string,
  record: {
    accountId: string;
    chatgptPlanType?: string | null;
    email?: string | null;
    expiresAt: Date;
  },
): OpenAICodexLiveSession => ({
  accessToken,
  accountId: record.accountId,
  chatgptPlanType: record.chatgptPlanType || undefined,
  email: record.email || undefined,
  expiresAt: record.expiresAt,
});

export class OpenAICodexOAuthService {
  private readonly db: LobeChatDatabase;
  private readonly fetchFn: FetchFn;
  private readonly lockUser: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  private readonly tokenStore: OpenAICodexTokenStore;
  private crypto?: TokenCrypto;

  constructor(
    db: LobeChatDatabase,
    options?: {
      crypto?: TokenCrypto;
      fetchFn?: FetchFn;
      lockUser?: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
      tokenStore?: OpenAICodexTokenStore;
    },
  ) {
    this.db = db;
    this.fetchFn = options?.fetchFn ?? fetch;
    this.lockUser = options?.lockUser ?? withOpenAICodexUserLock;
    this.crypto = options?.crypto;
    this.tokenStore = options?.tokenStore ?? createDrizzleOpenAICodexTokenStore(db);
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
    const startedAt = Date.now();
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
      logOpenAICodexDebugSafe('device_login_settled', {
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        outcome: 'error',
        reason: 'device_auth_failed',
      });
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

    logOpenAICodexDebugSafe('device_login_settled', {
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      outcome: 'ok',
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
      logOpenAICodexDebugSafe('device_poll_settled', { outcome: 'expired', reason: 'missing_handoff' });
      return { status: 'expired' };
    }

    const payload = handoff.payload as DeviceAuthHandoffPayload;
    if (payload.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Device login does not belong to this user.' });
    }

    if (payload.expiresAt <= Date.now()) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      logOpenAICodexDebugSafe('device_poll_settled', { outcome: 'expired', reason: 'handoff_timeout' });
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
        logOpenAICodexDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          outcome: 'denied',
          reason: error === 'expired_token' ? 'expired_token' : 'access_denied',
        });
        return { message: error, status: 'denied' };
      }
      logOpenAICodexDebugSafe('device_poll_settled', {
        httpStatus: tokenResponse.status,
        outcome: 'pending',
      });
      return { status: 'pending' };
    }

    if (!codeVerifier) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      logOpenAICodexDebugSafe('device_poll_settled', {
        httpStatus: tokenResponse.status,
        outcome: 'denied',
        reason: 'missing_code_verifier',
      });
      return { message: 'missing_code_verifier', status: 'denied' };
    }

    const exchanged = await this.exchangeAuthorizationCode(authorizationCode, codeVerifier);
    if (!exchanged) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      logOpenAICodexDebugSafe('device_poll_settled', {
        httpStatus: tokenResponse.status,
        outcome: 'denied',
        reason: 'token_exchange_failed',
      });
      return { message: 'token_exchange_failed', status: 'denied' };
    }

    const stored = await this.persistLoginTokens(userId, exchanged);
    await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
    logOpenAICodexDebugSafe('device_poll_settled', {
      hasAccountId: !!stored.accountId,
      hasEmail: !!stored.email,
      httpStatus: tokenResponse.status,
      outcome: 'connected',
    });

    return { ...sanitizeStatus(stored), status: 'connected' };
  }

  async getStatus(userId: string): Promise<OpenAICodexConnectionStatus> {
    const record = await this.tokenStore.findByUserId(userId);
    if (!record) return { connected: false };

    return sanitizeStatus(record);
  }

  async logout(userId: string): Promise<void> {
    await this.lockUser(userId, async () => {
      await this.tokenStore.deleteByUserId(userId);
    });
    logOpenAICodexDebugSafe('logout_settled', { outcome: 'ok' });
  }

  async resolveLiveSession(userId: string): Promise<OpenAICodexLiveSession | null> {
    const startedAt = Date.now();
    try {
      const session = await this.lockUser(userId, async () => {
      const record = await this.tokenStore.findByUserId(userId);
      if (!record) return null;

      const crypto = await this.getCrypto();
      const access = await crypto.decrypt(record.accessToken);
      const refresh = await crypto.decrypt(record.refreshToken);
      if (!access.wasAuthentic || !refresh.wasAuthentic || !access.plaintext || !refresh.plaintext) {
        await this.tokenStore.deleteIfRefreshMatches(userId, record.refreshToken);
        return null;
      }

      const needsRefresh = record.expiresAt.getTime() - Date.now() <= OPENAI_CODEX_REFRESH_SKEW_MS;
      if (!needsRefresh) return toLiveSession(access.plaintext, record);

      const lockId = randomUUID();
      const acquired = await this.tokenStore.tryAcquireRefreshLock(
        userId,
        lockId,
        OPENAI_CODEX_REFRESH_LOCK_TTL_MS,
      );
      if (!acquired) {
        return this.loadRefreshedOrTransientSession(userId, access.plaintext, record.expiresAt);
      }

      try {
        const latest = await this.tokenStore.findByUserId(userId);
        if (!latest) return null;

        const latestAccess = await crypto.decrypt(latest.accessToken);
        const latestRefresh = await crypto.decrypt(latest.refreshToken);
        if (
          !latestAccess.wasAuthentic ||
          !latestRefresh.wasAuthentic ||
          !latestAccess.plaintext ||
          !latestRefresh.plaintext
        ) {
          await this.tokenStore.deleteIfRefreshMatches(userId, latest.refreshToken, lockId);
          return null;
        }

        if (latest.expiresAt.getTime() - Date.now() > OPENAI_CODEX_REFRESH_SKEW_MS) {
          return toLiveSession(latestAccess.plaintext, latest);
        }

        const refreshed = await this.refreshAccessToken(latestRefresh.plaintext);
        if (refreshed.type === 'transient') {
          if (latest.expiresAt.getTime() > Date.now()) {
            return toLiveSession(latestAccess.plaintext, latest);
          }
          throw new OpenAICodexTransientRefreshError(
            'ChatGPT subscription refresh is temporarily unavailable.',
            refreshed.status,
          );
        }

        if (refreshed.type === 'invalid') {
          const deleted = await this.tokenStore.deleteIfRefreshMatches(
            userId,
            latest.refreshToken,
            lockId,
          );
          if (deleted) return null;
          return this.loadCurrentSession(userId);
        }

        const rotated = await this.rotateTokens(
          userId,
          latest.refreshToken,
          refreshed.tokens,
          lockId,
        );
        if (rotated) return toLiveSession(refreshed.tokens.accessToken, rotated);

        return this.loadCurrentSession(userId);
      } finally {
        await this.tokenStore.releaseRefreshLock(userId, lockId);
      }
      });
      logOpenAICodexDebugSafe('resolve_session_settled', {
        durationMs: Date.now() - startedAt,
        hasAccountId: !!session?.accountId,
        outcome: session ? 'live' : 'missing',
      });
      return session;
    } catch (error) {
      logOpenAICodexDebugSafe('resolve_session_settled', {
        durationMs: Date.now() - startedAt,
        errorClass: describeOpenAICodexErrorClass(error),
        outcome: error instanceof OpenAICodexTransientRefreshError ? 'transient' : 'error',
      });
      throw error;
    }
  }

  private async loadRefreshedOrTransientSession(
    userId: string,
    fallbackAccessToken: string,
    fallbackExpiresAt: Date,
  ): Promise<OpenAICodexLiveSession | null> {
    const latest = await this.tokenStore.findByUserId(userId);
    if (!latest) return null;

    if (latest.expiresAt.getTime() - Date.now() > OPENAI_CODEX_REFRESH_SKEW_MS) {
      return this.loadCurrentSession(userId);
    }

    if (latest.expiresAt.getTime() > Date.now()) {
      const crypto = await this.getCrypto();
      const latestAccess = await crypto.decrypt(latest.accessToken);
      if (latestAccess.wasAuthentic && latestAccess.plaintext) {
        return toLiveSession(latestAccess.plaintext, latest);
      }
      return toLiveSession(fallbackAccessToken, latest);
    }

    if (fallbackExpiresAt.getTime() > Date.now()) {
      return toLiveSession(fallbackAccessToken, latest);
    }

    throw new OpenAICodexTransientRefreshError(
      'ChatGPT subscription refresh is temporarily unavailable.',
      0,
    );
  }

  private async loadCurrentSession(userId: string): Promise<OpenAICodexLiveSession | null> {
    const record = await this.tokenStore.findByUserId(userId);
    if (!record) return null;

    const crypto = await this.getCrypto();
    const access = await crypto.decrypt(record.accessToken);
    if (!access.wasAuthentic || !access.plaintext) return null;

    return toLiveSession(access.plaintext, record);
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
    if (!response.ok || !accessToken || !refreshToken) {
      logOpenAICodexDebugSafe('token_exchange_settled', {
        httpStatus: response.status,
        outcome: 'error',
      });
      return null;
    }

    logOpenAICodexDebugSafe('token_exchange_settled', {
      httpStatus: response.status,
      outcome: 'ok',
    });

    return {
      accessToken,
      expiresAt: computeExpiresAt(
        typeof body.expires_in === 'number' ? body.expires_in : undefined,
        accessToken,
      ),
      refreshToken,
    };
  }

  private async refreshAccessToken(refreshToken: string): Promise<RefreshOutcome> {
    let response: Response;
    try {
      response = await this.fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
        body: new URLSearchParams({
          client_id: OPENAI_CODEX_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        headers: formHeaders,
        method: 'POST',
      });
    } catch {
      logOpenAICodexDebugSafe('refresh_settled', { httpStatus: 0, outcome: 'transient' });
      return { status: 0, type: 'transient' };
    }

    const body = parseJsonObject(await response.text());
    const error = asOptionalString(body.error);
    if (
      error === 'invalid_grant' ||
      error === 'invalid_refresh_token' ||
      error === 'refresh_token_reused'
    ) {
      logOpenAICodexDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'invalid',
        reason: error === 'refresh_token_reused' ? 'refresh_token_reused' : 'invalid_grant',
      });
      return { type: 'invalid' };
    }

    if (!response.ok) {
      logOpenAICodexDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'transient',
      });
      return { status: response.status, type: 'transient' };
    }

    const accessToken = asOptionalString(body.access_token);
    if (!accessToken) {
      logOpenAICodexDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'transient',
        reason: 'missing_access_token',
      });
      return { status: response.status, type: 'transient' };
    }

    logOpenAICodexDebugSafe('refresh_settled', {
      httpStatus: response.status,
      outcome: 'ok',
    });

    return {
      tokens: {
        accessToken,
        expiresAt: computeExpiresAt(
          typeof body.expires_in === 'number' ? body.expires_in : undefined,
          accessToken,
        ),
        refreshToken: asOptionalString(body.refresh_token) || refreshToken,
      },
      type: 'success',
    };
  }

  private async encryptTokenRow(
    userId: string,
    tokens: { accessToken: string; expiresAt: Date; refreshToken: string },
  ): Promise<NewOpenAICodexOAuthTokenItem> {
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

    return {
      accessToken,
      accountId: identity.accountId,
      chatgptPlanType: identity.chatgptPlanType,
      clientId: OPENAI_CODEX_CLIENT_ID,
      email: identity.email,
      expiresAt: tokens.expiresAt,
      refreshToken,
      userId,
    };
  }

  private async persistLoginTokens(
    userId: string,
    tokens: { accessToken: string; expiresAt: Date; refreshToken: string },
  ) {
    return this.lockUser(userId, async () => {
      const insert = await this.encryptTokenRow(userId, tokens);
      await this.tokenStore.upsert(insert);
      return {
        accountId: insert.accountId,
        chatgptPlanType: insert.chatgptPlanType,
        email: insert.email,
        expiresAt: tokens.expiresAt,
      };
    });
  }

  private async rotateTokens(
    userId: string,
    expectedRefreshCiphertext: string,
    tokens: { accessToken: string; expiresAt: Date; refreshToken: string },
    lockId: string,
  ) {
    const insert = await this.encryptTokenRow(userId, tokens);
    const updated = await this.tokenStore.updateIfRefreshMatches(
      userId,
      expectedRefreshCiphertext,
      insert,
      lockId,
    );
    if (!updated) return null;

    return {
      accountId: insert.accountId,
      chatgptPlanType: insert.chatgptPlanType,
      email: insert.email,
      expiresAt: tokens.expiresAt,
    };
  }
}
