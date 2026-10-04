/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: {
    OPENSANDBOX_CPU: '1',
    OPENSANDBOX_EGRESS_ALLOW: undefined,
    OPENSANDBOX_IMAGE: undefined,
    OPENSANDBOX_MEMORY: '2Gi',
    OPENSANDBOX_READY_TIMEOUT: 5000,
    OPENSANDBOX_SERVER_URL: undefined,
    OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
    OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
    SANDBOX_MAX_FILE_BYTES: 1024,
    SANDBOX_MAX_FILE_COUNT: 20,
    SANDBOX_MAX_OUTPUT_CHARS: 30_000,
    SANDBOX_MAX_TIMEOUT: 600_000,
    SANDBOX_TIMEOUT: 60_000,
  },
}));

import { getSandboxProvider, isSandboxConfigured } from '../registry';

describe('sandbox provider registry', () => {
  it('always uses OpenSandbox', () => {
    expect(getSandboxProvider().id).toBe('opensandbox');
  });

  it('is not configured without a server URL and image', () => {
    expect(isSandboxConfigured()).toBe(false);
  });
});
