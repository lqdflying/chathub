import {
  XAI_DEVICE_CODE_DEFAULT_INTERVAL_MS,
  XAI_DEVICE_CODE_MIN_INTERVAL_MS,
  XAI_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS,
} from './constants';

export const resolveXaiDevicePollIntervalMs = (intervalSeconds?: unknown): number => {
  if (typeof intervalSeconds === 'number' && Number.isFinite(intervalSeconds) && intervalSeconds > 0) {
    return Math.max(Math.trunc(intervalSeconds * 1000), XAI_DEVICE_CODE_MIN_INTERVAL_MS);
  }

  return XAI_DEVICE_CODE_DEFAULT_INTERVAL_MS;
};

export const resolveXaiDevicePollDelayMs = (
  intervalMs: number,
  expiresAt: number,
  now: number,
): number => {
  const remainingMs = Math.max(0, expiresAt - now);
  return Math.min(Math.max(intervalMs, XAI_DEVICE_CODE_MIN_INTERVAL_MS), remainingMs);
};

export const increaseXaiDevicePollIntervalMs = (intervalMs: number): number =>
  intervalMs + XAI_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;

export const isXaiDeviceAuthorizationPending = (error?: string) => error === 'authorization_pending';

export const isXaiDeviceSlowDown = (error?: string) => error === 'slow_down';

export const isXaiDeviceExpiredToken = (error?: string) => error === 'expired_token';

export const isXaiDeviceDenied = (error?: string) =>
  error === 'access_denied' || error === 'authorization_denied' || error === 'invalid_client';
