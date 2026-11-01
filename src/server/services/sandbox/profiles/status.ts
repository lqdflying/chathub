import type { SandboxServerHealth } from '@lobechat/types';

import { OpenSandboxClient } from '../providers/opensandbox/client';
import { getSandboxProfileCatalog } from './load';

const HEALTH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5000;

const healthCache = new Map<string, { at: number; health: SandboxServerHealth }>();

/** Test hook. */
export const clearSandboxServerHealthCache = () => healthCache.clear();

/**
 * Status of every server a profile uses, keyed by server id. Cached for 30 s
 * per server so opening the Hub does not hammer remote servers. URLs and keys
 * are never part of the result.
 */
export const getSandboxServerHealth = async (
  now = Date.now(),
): Promise<Record<string, SandboxServerHealth>> => {
  const entries = await Promise.all(
    getSandboxProfileCatalog().servers.map(async (server) => {
      if (server.status !== 'ok') return [server.id, 'misconfigured'] as const;
      const cacheKey = `${server.id}\u0000${server.url}`;
      const cached = healthCache.get(cacheKey);
      if (cached && now - cached.at < HEALTH_TTL_MS) return [server.id, cached.health] as const;
      const health = await new OpenSandboxClient({
        apiKey: server.apiKey,
        baseUrl: server.url,
      }).health(AbortSignal.timeout(HEALTH_TIMEOUT_MS));
      healthCache.set(cacheKey, { at: now, health });
      return [server.id, health] as const;
    }),
  );
  return Object.fromEntries(entries);
};
