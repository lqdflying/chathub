import { describe, expect, it, vi } from 'vitest';

describe('accountScopeReset module initialization', () => {
  it('initializes account-scoped stores from a fresh module graph', async () => {
    vi.resetModules();

    const accountScopeResetModule = await import('./accountScopeReset');

    expect(accountScopeResetModule.resetAccountScopedStores).toBeTypeOf('function');
  }, 15_000);
});
