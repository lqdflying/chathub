/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/codeInterpreter', () => ({
  codeInterpreterEnv: {
    get SANDBOX_PROVIDER() {
      return process.env.SANDBOX_PROVIDER ?? 'dify';
    },
    CODE_INTERPRETER_SANDBOX_URL: undefined,
  },
}));

import { getSandboxProvider } from '../registry';

describe('sandbox provider registry', () => {
  afterEach(() => {
    delete process.env.SANDBOX_PROVIDER;
  });

  it('defaults to the Dify provider', () => {
    expect(getSandboxProvider().id).toBe('dify');
  });

  it('returns not_configured for an unknown provider without throwing at boot', async () => {
    process.env.SANDBOX_PROVIDER = 'microsandbox';
    const provider = getSandboxProvider();
    expect(provider.id).toBe('microsandbox');
    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.run({ code: 'print(1)', files: [], language: 'python3' }),
    ).rejects.toMatchObject({
      code: 'NotConfigured',
      outcome: 'not_configured',
    });
  });
});
