import { afterEach, describe, expect, it, vi } from 'vitest';

import { telemetryRouter } from './telemetry';

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn().mockReturnValue({ userId: 'diagnostic-capability-test-user' }),
}));

const createCaller = () =>
  telemetryRouter.createCaller({
    authorizationHeader: 'Bearer diagnostic-capability-test-token',
    userId: 'diagnostic-capability-test-user',
  } as any);

describe('telemetryRouter diagnostic capabilities', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports cache continuation when cache diagnostics and keyed fingerprints are enabled', async () => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '0');
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', 'diagnostic-fingerprint-secret');

    await expect(createCaller().getStatus()).resolves.toEqual({
      cacheContinuationEnabled: true,
      toolLifecycleEnabled: false,
    });
  });

  it('does not report cache continuation without a fingerprint secret', async () => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '0');
    vi.stubEnv('DEBUG_OPENAI_CACHE', '1');
    vi.stubEnv('KEY_VAULTS_SECRET', '');
    vi.stubEnv('NEXT_AUTH_SECRET', '');

    await expect(createCaller().getStatus()).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: false,
    });
  });

  it('reports tool lifecycle logging independently from cache diagnostics', async () => {
    vi.stubEnv('CHATHUB_TOOLS_DEBUG', '1');
    vi.stubEnv('DEBUG_OPENAI_CACHE', '0');
    vi.stubEnv('DEBUG_OPENAICOMPATIBLE_CACHE', '0');

    await expect(createCaller().getStatus()).resolves.toEqual({
      cacheContinuationEnabled: false,
      toolLifecycleEnabled: true,
    });
  });
});
