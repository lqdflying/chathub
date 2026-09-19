import { randomUUID } from 'node:crypto';

import { LobeChatDatabase } from '@lobechat/database';
import {
  describeXaiOAuthErrorClass,
  increaseXaiDevicePollIntervalMs,
  isTrustedXaiOAuthHost,
  isXaiDeviceAuthorizationPending,
  isXaiDeviceDenied,
  isXaiDeviceExpiredToken,
  isXaiDeviceSlowDown,
  logXaiOAuthDebugSafe,
  resolveXaiDevicePollDelayMs,
  resolveXaiDevicePollIntervalMs,
  XAI_DEVICE_CODE_GRANT_TYPE,
  XAI_DEVICE_CODE_TOKEN_TIMEOUT_MS,
  XAI_OAUTH_BILLING_URL,
  XAI_OAUTH_CLIENT_HEADERS,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DEVICE_TIMEOUT_MS,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_HANDOFF_CLIENT,
  XAI_OAUTH_LEGACY_TOKEN_ENDPOINT,
  XAI_OAUTH_REFRESH_SKEW_MS,
  XAI_OAUTH_REFRESH_TIMEOUT_MS,
  XAI_OAUTH_SCOPE,
  XAI_OAUTH_USAGE_TIMEOUT_MS,
  XAI_OAUTH_USER_AGENT,
} from '@lobechat/model-runtime';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { NewXaiOAuthTokenItem } from '@/database/schemas/xaiOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';
import { generateState } from '@/libs/mcp/pkce';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { XaiOAuthTransientRefreshError } from './errors';
import { resolveXaiOAuthJwtIdentity } from './jwt';
import { createDrizzleXaiOAuthTokenStore, type XaiOAuthTokenStore } from './tokenStore';
import type {
  XaiOAuthConnectionStatus,
  XaiOAuthDeviceLoginPoll,
  XaiOAuthDeviceLoginStart,
  XaiOAuthLiveSession,
} from './types';
import { parseXaiUsageWindows } from './usage';

type FetchFn = typeof fetch;

type TokenCrypto = {
  decrypt: (value: string) => Promise<{ plaintext: string; wasAuthentic: boolean }>;
  encrypt: (value: string) => Promise<string>;
};

type DeviceAuthHandoffPayload = {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  tokenEndpoint: string;
  userCode: string;
  userId: string;
};

type RefreshOutcome =
  | { tokens: { accessToken: string; expiresAt: Date; refreshToken: string }; type: 'success' }
  | { type: 'invalid' }
  | { status: number; type: 'transient' };

const XAI_OAUTH_REFRESH_LOCK_TTL_MS = 30_000;

const userLocks = new Map<string, Promise<unknown>>();
const devicePollInFlight = new Set<string>();

export const withXaiOAuthUserLock = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
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
  'User-Agent': XAI_OAUTH_USER_AGENT,
};

const formHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': XAI_OAUTH_USER_AGENT,
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

export const requireTrustedXaiOAuthEndpoint = (endpoint: string, label: string): string => {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !isTrustedXaiOAuthHost(url.hostname)) {
      throw new Error(`xAI OAuth discovery returned untrusted ${label}`);
    }
    return endpoint;
  } catch (error) {
    if (error instanceof Error && error.message.includes('untrusted')) throw error;
    throw new Error(`xAI OAuth discovery returned untrusted ${label}`);
  }
};

const computeExpiresAt = (expiresIn?: number, accessToken?: string): Date => {
  if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000);
  }

  const identity = resolveXaiOAuthJwtIdentity(accessToken);
  if (identity?.exp) return new Date(identity.exp * 1000);

  return new Date(Date.now() + 60 * 60 * 1000);
};

const sanitizeStatus = (session: {
  email?: string | null;
  expiresAt: Date;
  plan?: string | null;
}): XaiOAuthConnectionStatus => ({
  connected: true,
  email: session.email || undefined,
  expiresAt: session.expiresAt.toISOString(),
  plan: session.plan || undefined,
});

const toLiveSession = (
  accessToken: string,
  record: {
    email?: string | null;
    expiresAt: Date;
    plan?: string | null;
    tokenEndpoint?: string | null;
  },
): XaiOAuthLiveSession => ({
  accessToken,
  email: record.email || undefined,
  expiresAt: record.expiresAt,
  plan: record.plan || undefined,
  tokenEndpoint: record.tokenEndpoint || undefined,
});

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

const rejectWhenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    const fail = () => {
      reject(
        signal.reason ??
          Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
      );
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });

const fetchTextWithTimeout = async (
  fetchFn: FetchFn,
  url: string,
  init: NonNullable<Parameters<FetchFn>[1]>,
  timeoutMs: number,
): Promise<{ bodyText: string; response: Response }> => {
  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = rejectWhenAborted(signal);
  void aborted.catch(() => undefined);
  const request = Promise.resolve(fetchFn(url, { ...init, signal }));
  void request.catch(() => undefined);
  const response = await Promise.race([request, aborted]);
  const textPromise = Promise.resolve(response.text());
  void textPromise.catch(() => undefined);
  const bodyText = await Promise.race([textPromise, aborted]);
  return { bodyText, response };
};

type TransientRefreshMemory = { ciphertext: string; until: number };

const recentTransientRefreshes = new Map<string, TransientRefreshMemory>();

export const resetXaiOAuthRefreshCooldownForTests = () => {
  recentTransientRefreshes.clear();
};

const rememberTransientRefresh = (userId: string, refreshCiphertext: string, cooldownMs: number) => {
  recentTransientRefreshes.set(userId, {
    ciphertext: refreshCiphertext,
    until: Date.now() + cooldownMs,
  });
};

const clearTransientRefresh = (userId: string) => {
  recentTransientRefreshes.delete(userId);
};

const hasRecentTransientRefresh = (userId: string, refreshCiphertext: string): boolean => {
  const entry = recentTransientRefreshes.get(userId);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    recentTransientRefreshes.delete(userId);
    return false;
  }
  return entry.ciphertext === refreshCiphertext;
};

const sessionOrTransientRefresh = (
  accessToken: string,
  record: {
    email?: string | null;
    expiresAt: Date;
    plan?: string | null;
    tokenEndpoint?: string | null;
  },
): XaiOAuthLiveSession => {
  if (record.expiresAt.getTime() > Date.now()) return toLiveSession(accessToken, record);
  throw new XaiOAuthTransientRefreshError('SuperGrok refresh is temporarily unavailable.', 0);
};

export class XaiOAuthService {
  private readonly db: LobeChatDatabase;
  private readonly fetchFn: FetchFn;
  private readonly lockUser: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  private readonly now: () => number;
  private readonly refreshTimeoutMs: number;
  private readonly tokenTimeoutMs: number;
  private readonly tokenStore: XaiOAuthTokenStore;
  private crypto?: TokenCrypto;

  constructor(
    db: LobeChatDatabase,
    options?: {
      crypto?: TokenCrypto;
      fetchFn?: FetchFn;
      lockUser?: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
      now?: () => number;
      refreshTimeoutMs?: number;
      tokenStore?: XaiOAuthTokenStore;
      tokenTimeoutMs?: number;
    },
  ) {
    this.db = db;
    this.fetchFn = options?.fetchFn ?? fetch;
    this.lockUser = options?.lockUser ?? withXaiOAuthUserLock;
    this.now = options?.now ?? Date.now;
    this.refreshTimeoutMs = options?.refreshTimeoutMs ?? XAI_OAUTH_REFRESH_TIMEOUT_MS;
    this.tokenTimeoutMs = options?.tokenTimeoutMs ?? XAI_DEVICE_CODE_TOKEN_TIMEOUT_MS;
    this.crypto = options?.crypto;
    this.tokenStore = options?.tokenStore ?? createDrizzleXaiOAuthTokenStore(db);
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

  async discoverEndpoints(): Promise<{
    deviceAuthorizationEndpoint: string;
    tokenEndpoint: string;
  }> {
    const response = await this.fetchFn(XAI_OAUTH_DISCOVERY_URL, { headers: jsonHeaders });
    const body = parseJsonObject(await response.text());
    const deviceAuthorizationEndpoint = asOptionalString(body.device_authorization_endpoint);
    const tokenEndpoint =
      asOptionalString(body.token_endpoint) || XAI_OAUTH_LEGACY_TOKEN_ENDPOINT;

    if (!response.ok || !deviceAuthorizationEndpoint) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `xAI OAuth discovery failed (HTTP ${response.status}).`,
      });
    }

    return {
      deviceAuthorizationEndpoint: requireTrustedXaiOAuthEndpoint(
        deviceAuthorizationEndpoint,
        'device_authorization_endpoint',
      ),
      tokenEndpoint: requireTrustedXaiOAuthEndpoint(tokenEndpoint, 'token_endpoint'),
    };
  }

  async startDeviceLogin(userId: string): Promise<XaiOAuthDeviceLoginStart> {
    const startedAt = Date.now();
    const endpoints = await this.discoverEndpoints();
    const response = await this.fetchFn(endpoints.deviceAuthorizationEndpoint, {
      body: new URLSearchParams({
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
      }),
      headers: formHeaders,
      method: 'POST',
    });
    const bodyText = await response.text();
    const body = parseJsonObject(bodyText);
    const deviceCode = asOptionalString(body.device_code);
    const userCode = asOptionalString(body.user_code);
    const verificationUrl =
      asOptionalString(body.verification_uri_complete) ||
      asOptionalString(body.verification_uri) ||
      asOptionalString(body.verification_url);

    if (!response.ok || !deviceCode || !userCode || !verificationUrl) {
      logXaiOAuthDebugSafe('device_login_settled', {
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        outcome: 'error',
        reason: 'device_auth_failed',
      });
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `xAI device authorization failed (HTTP ${response.status}).`,
      });
    }

    const expiresIn =
      typeof body.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in * 1000
        : XAI_OAUTH_DEVICE_TIMEOUT_MS;
    const handoffId = generateState();
    const now = this.now();
    const expiresAt = now + expiresIn;
    const intervalMs = resolveXaiDevicePollIntervalMs(body.interval);
    const payload: DeviceAuthHandoffPayload = {
      deviceCode,
      expiresAt,
      intervalMs,
      nextPollAt: now + intervalMs,
      tokenEndpoint: endpoints.tokenEndpoint,
      userCode,
      userId,
    };

    await this.db.insert(oauthHandoffs).values({
      client: XAI_OAUTH_HANDOFF_CLIENT,
      id: handoffId,
      payload,
    });

    logXaiOAuthDebugSafe('device_login_settled', {
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      intervalMs,
      outcome: 'ok',
    });

    return {
      expiresAt: new Date(expiresAt).toISOString(),
      handoffId,
      intervalMs,
      userCode,
      verificationUrl,
    };
  }

  async pollDeviceLogin(userId: string, handoffId: string): Promise<XaiOAuthDeviceLoginPoll> {
    const [handoff] = await this.db.select().from(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));

    if (!handoff || handoff.client !== XAI_OAUTH_HANDOFF_CLIENT) {
      logXaiOAuthDebugSafe('device_poll_settled', { outcome: 'expired', reason: 'missing_handoff' });
      return { status: 'expired' };
    }

    const payload = handoff.payload as DeviceAuthHandoffPayload;
    if (payload.userId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Device login does not belong to this user.' });
    }

    const now = this.now();
    if (payload.expiresAt <= now) {
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      logXaiOAuthDebugSafe('device_poll_settled', { outcome: 'expired', reason: 'handoff_timeout' });
      return { status: 'expired' };
    }

    const waitMs = Math.max(0, payload.nextPollAt - now);
    if (waitMs > 0 || devicePollInFlight.has(handoffId)) {
      const nextDelayMs = resolveXaiDevicePollDelayMs(
        waitMs > 0 ? waitMs : payload.intervalMs,
        payload.expiresAt,
        now,
      );
      logXaiOAuthDebugSafe('device_poll_settled', {
        nextDelayMs,
        outcome: 'pending',
        reason: devicePollInFlight.has(handoffId) ? 'in_flight' : 'interval',
      });
      return { intervalMs: payload.intervalMs, nextDelayMs, status: 'pending' };
    }

    devicePollInFlight.add(handoffId);
    const reserved: DeviceAuthHandoffPayload = {
      ...payload,
      nextPollAt: now + payload.intervalMs,
    };
    await this.saveDeviceHandoff(handoffId, reserved);

    try {
      requireTrustedXaiOAuthEndpoint(payload.tokenEndpoint, 'token_endpoint');
      const { bodyText: tokenText, response: tokenResponse } = await fetchTextWithTimeout(
        this.fetchFn,
        payload.tokenEndpoint,
        {
          body: new URLSearchParams({
            client_id: XAI_OAUTH_CLIENT_ID,
            device_code: payload.deviceCode,
            grant_type: XAI_DEVICE_CODE_GRANT_TYPE,
          }),
          headers: formHeaders,
          method: 'POST',
        },
        this.tokenTimeoutMs,
      );
      const tokenBody = parseJsonObject(tokenText);
      const error = asOptionalString(tokenBody.error);
      const accessToken = asOptionalString(tokenBody.access_token);
      const refreshToken = asOptionalString(tokenBody.refresh_token);

      if (isXaiDeviceAuthorizationPending(error)) {
        const nextDelayMs = resolveXaiDevicePollDelayMs(reserved.intervalMs, reserved.expiresAt, this.now());
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          nextDelayMs,
          outcome: 'pending',
        });
        return { intervalMs: reserved.intervalMs, nextDelayMs, status: 'pending' };
      }

      if (isXaiDeviceSlowDown(error)) {
        const intervalMs = increaseXaiDevicePollIntervalMs(reserved.intervalMs);
        const slowed: DeviceAuthHandoffPayload = {
          ...reserved,
          intervalMs,
          nextPollAt: now + intervalMs,
        };
        await this.saveDeviceHandoff(handoffId, slowed);
        const nextDelayMs = resolveXaiDevicePollDelayMs(intervalMs, slowed.expiresAt, this.now());
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          intervalMs,
          nextDelayMs,
          outcome: 'pending',
          reason: 'slow_down',
        });
        return { intervalMs, nextDelayMs, status: 'pending' };
      }

      if (isXaiDeviceExpiredToken(error)) {
        await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          outcome: 'expired',
          reason: error,
        });
        return { status: 'expired' };
      }

      if (isXaiDeviceDenied(error)) {
        await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          outcome: 'denied',
          reason: error,
        });
        return { message: error, status: 'denied' };
      }

      if (!tokenResponse.ok || !accessToken || !refreshToken) {
        await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: tokenResponse.status,
          outcome: 'denied',
          reason: error || 'token_exchange_failed',
        });
        return { message: error || 'token_exchange_failed', status: 'denied' };
      }

      const stored = await this.persistLoginTokens(userId, {
        accessToken,
        expiresAt: computeExpiresAt(
          typeof tokenBody.expires_in === 'number' ? tokenBody.expires_in : undefined,
          accessToken,
        ),
        idToken: asOptionalString(tokenBody.id_token),
        refreshToken,
        tokenEndpoint: payload.tokenEndpoint,
      });
      await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, handoffId));
      logXaiOAuthDebugSafe('device_poll_settled', {
        httpStatus: tokenResponse.status,
        outcome: 'connected',
      });

      return { ...sanitizeStatus(stored), status: 'connected' };
    } catch (error) {
      if (isTimeoutError(error)) {
        const nextDelayMs = resolveXaiDevicePollDelayMs(reserved.intervalMs, reserved.expiresAt, this.now());
        logXaiOAuthDebugSafe('device_poll_settled', {
          httpStatus: 0,
          nextDelayMs,
          outcome: 'pending',
          reason: 'token_timeout',
        });
        return { intervalMs: reserved.intervalMs, nextDelayMs, status: 'pending' };
      }
      throw error;
    } finally {
      devicePollInFlight.delete(handoffId);
    }
  }

  private async saveDeviceHandoff(handoffId: string, payload: DeviceAuthHandoffPayload) {
    await this.db.update(oauthHandoffs).set({ payload }).where(eq(oauthHandoffs.id, handoffId));
  }

  async getStatus(userId: string): Promise<XaiOAuthConnectionStatus> {
    const record = await this.tokenStore.findByUserId(userId);
    if (!record) return { connected: false };

    const status = sanitizeStatus(record);
    try {
      const session = await this.resolveLiveSession(userId);
      if (!session) {
        const latest = await this.tokenStore.findByUserId(userId);
        return latest ? sanitizeStatus(latest) : { connected: false };
      }
      return { ...sanitizeStatus(session), ...(await this.fetchUsageWindows(session)) };
    } catch {
      return status;
    }
  }

  private async fetchUsageWindows(
    session: XaiOAuthLiveSession,
  ): Promise<Pick<XaiOAuthConnectionStatus, 'fiveHour' | 'weekly'>> {
    const startedAt = Date.now();
    try {
      const response = await this.fetchFn(XAI_OAUTH_BILLING_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'User-Agent': XAI_OAUTH_USER_AGENT,
          ...XAI_OAUTH_CLIENT_HEADERS,
        },
        method: 'GET',
        signal: AbortSignal.timeout(XAI_OAUTH_USAGE_TIMEOUT_MS),
      });
      const bodyText = await response.text();
      if (!response.ok) {
        logXaiOAuthDebugSafe('usage_fetch_settled', {
          durationMs: Date.now() - startedAt,
          httpStatus: response.status,
          outcome: 'error',
          reason: 'usage_http_error',
        });
        return {};
      }

      const usage = parseXaiUsageWindows(parseJsonObject(bodyText));
      logXaiOAuthDebugSafe('usage_fetch_settled', {
        durationMs: Date.now() - startedAt,
        hasFiveHour: !!usage.fiveHour,
        hasWeekly: !!usage.weekly,
        httpStatus: response.status,
        outcome: usage.fiveHour || usage.weekly ? 'ok' : 'missing',
      });
      return usage;
    } catch {
      logXaiOAuthDebugSafe('usage_fetch_settled', {
        durationMs: Date.now() - startedAt,
        httpStatus: 0,
        outcome: 'error',
        reason: 'usage_fetch_failed',
      });
      return {};
    }
  }

  async logout(userId: string): Promise<void> {
    clearTransientRefresh(userId);
    await this.lockUser(userId, async () => {
      await this.tokenStore.deleteByUserId(userId);
    });
    logXaiOAuthDebugSafe('logout_settled', { outcome: 'ok' });
  }

  async resolveLiveSession(userId: string): Promise<XaiOAuthLiveSession | null> {
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

        const needsRefresh = record.expiresAt.getTime() - Date.now() <= XAI_OAUTH_REFRESH_SKEW_MS;
        if (!needsRefresh) return toLiveSession(access.plaintext, record);

        if (hasRecentTransientRefresh(userId, record.refreshToken)) {
          return sessionOrTransientRefresh(access.plaintext, record);
        }

        const lockId = randomUUID();
        const acquired = await this.tokenStore.tryAcquireRefreshLock(
          userId,
          lockId,
          XAI_OAUTH_REFRESH_LOCK_TTL_MS,
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

          if (latest.expiresAt.getTime() - Date.now() > XAI_OAUTH_REFRESH_SKEW_MS) {
            return toLiveSession(latestAccess.plaintext, latest);
          }

          const refreshed = await this.refreshAccessToken(
            latestRefresh.plaintext,
            latest.tokenEndpoint || XAI_OAUTH_LEGACY_TOKEN_ENDPOINT,
          );
          if (refreshed.type === 'transient') {
            rememberTransientRefresh(userId, latest.refreshToken, this.refreshTimeoutMs);
            if (latest.expiresAt.getTime() > Date.now()) {
              return toLiveSession(latestAccess.plaintext, latest);
            }
            throw new XaiOAuthTransientRefreshError(
              'SuperGrok refresh is temporarily unavailable.',
              refreshed.status,
            );
          }

          clearTransientRefresh(userId);

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
            { ...refreshed.tokens, tokenEndpoint: latest.tokenEndpoint || undefined },
            lockId,
          );
          if (rotated) return toLiveSession(refreshed.tokens.accessToken, rotated);

          return this.loadCurrentSession(userId);
        } finally {
          await this.tokenStore.releaseRefreshLock(userId, lockId);
        }
      });
      logXaiOAuthDebugSafe('resolve_session_settled', {
        durationMs: Date.now() - startedAt,
        outcome: session ? 'live' : 'missing',
      });
      return session;
    } catch (error) {
      logXaiOAuthDebugSafe('resolve_session_settled', {
        durationMs: Date.now() - startedAt,
        errorClass: describeXaiOAuthErrorClass(error),
        outcome: error instanceof XaiOAuthTransientRefreshError ? 'transient' : 'error',
      });
      throw error;
    }
  }

  private async loadRefreshedOrTransientSession(
    userId: string,
    fallbackAccessToken: string,
    fallbackExpiresAt: Date,
  ): Promise<XaiOAuthLiveSession | null> {
    const latest = await this.tokenStore.findByUserId(userId);
    if (!latest) return null;

    if (latest.expiresAt.getTime() - Date.now() > XAI_OAUTH_REFRESH_SKEW_MS) {
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

    throw new XaiOAuthTransientRefreshError('SuperGrok refresh is temporarily unavailable.', 0);
  }

  private async loadCurrentSession(userId: string): Promise<XaiOAuthLiveSession | null> {
    const record = await this.tokenStore.findByUserId(userId);
    if (!record) return null;

    const crypto = await this.getCrypto();
    const access = await crypto.decrypt(record.accessToken);
    if (!access.wasAuthentic || !access.plaintext) return null;

    return toLiveSession(access.plaintext, record);
  }

  private async refreshAccessToken(refreshToken: string, tokenEndpoint: string): Promise<RefreshOutcome> {
    requireTrustedXaiOAuthEndpoint(tokenEndpoint, 'token_endpoint');
    let bodyText: string;
    let response: Response;
    try {
      ({ bodyText, response } = await fetchTextWithTimeout(
        this.fetchFn,
        tokenEndpoint,
        {
          body: new URLSearchParams({
            client_id: XAI_OAUTH_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
          headers: formHeaders,
          method: 'POST',
        },
        this.refreshTimeoutMs,
      ));
    } catch (error) {
      logXaiOAuthDebugSafe('refresh_settled', {
        httpStatus: 0,
        outcome: 'transient',
        reason: isTimeoutError(error) ? 'timeout' : 'refresh_fetch_failed',
      });
      return { status: 0, type: 'transient' };
    }

    const body = parseJsonObject(bodyText);
    const error = asOptionalString(body.error);
    if (error === 'invalid_grant' || error === 'invalid_refresh_token' || error === 'refresh_token_reused') {
      logXaiOAuthDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'invalid',
        reason: error === 'refresh_token_reused' ? 'refresh_token_reused' : 'invalid_grant',
      });
      return { type: 'invalid' };
    }

    if (!response.ok) {
      logXaiOAuthDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'transient',
      });
      return { status: response.status, type: 'transient' };
    }

    const accessToken = asOptionalString(body.access_token);
    if (!accessToken) {
      logXaiOAuthDebugSafe('refresh_settled', {
        httpStatus: response.status,
        outcome: 'transient',
        reason: 'missing_access_token',
      });
      return { status: response.status, type: 'transient' };
    }

    logXaiOAuthDebugSafe('refresh_settled', { httpStatus: response.status, outcome: 'ok' });

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
    tokens: {
      accessToken: string;
      expiresAt: Date;
      idToken?: string;
      refreshToken: string;
      tokenEndpoint?: string;
    },
  ): Promise<NewXaiOAuthTokenItem> {
    const identity =
      resolveXaiOAuthJwtIdentity(tokens.idToken) || resolveXaiOAuthJwtIdentity(tokens.accessToken);
    const crypto = await this.getCrypto();
    const [accessToken, refreshToken] = await Promise.all([
      crypto.encrypt(tokens.accessToken),
      crypto.encrypt(tokens.refreshToken),
    ]);

    return {
      accessToken,
      clientId: XAI_OAUTH_CLIENT_ID,
      email: identity?.email,
      expiresAt: tokens.expiresAt,
      refreshToken,
      tokenEndpoint: tokens.tokenEndpoint,
      userId,
    };
  }

  private async persistLoginTokens(
    userId: string,
    tokens: {
      accessToken: string;
      expiresAt: Date;
      idToken?: string;
      refreshToken: string;
      tokenEndpoint?: string;
    },
  ) {
    return this.lockUser(userId, async () => {
      clearTransientRefresh(userId);
      const insert = await this.encryptTokenRow(userId, tokens);
      await this.tokenStore.upsert(insert);
      return {
        email: insert.email,
        expiresAt: tokens.expiresAt,
        plan: insert.plan,
      };
    });
  }

  private async rotateTokens(
    userId: string,
    expectedRefreshCiphertext: string,
    tokens: { accessToken: string; expiresAt: Date; refreshToken: string; tokenEndpoint?: string },
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
      email: insert.email,
      expiresAt: tokens.expiresAt,
      plan: insert.plan,
      tokenEndpoint: insert.tokenEndpoint,
    };
  }
}
