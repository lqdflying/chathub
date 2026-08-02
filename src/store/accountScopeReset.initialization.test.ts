import { describe, expect, it, vi } from 'vitest';

describe('accountScopeReset module initialization', () => {
  it('initializes account-scoped stores from a fresh module graph', async () => {
    vi.resetModules();

    const accountScopeResetModule = await import('./accountScopeReset');
    const { useSkillStore } = await import('./skill');

    expect(accountScopeResetModule.resetAccountScopedStores).toBeTypeOf('function');
    useSkillStore.setState({
      installedSkills: [
        {
          contentHash: 'hash-a',
          createdAt: new Date(0),
          description: 'Account A skill',
          identifier: 'account-a-skill',
          name: 'account-a-skill',
          sourceType: 'url',
          updatedAt: new Date(0),
        },
      ],
      isLoading: false,
      selectedSkillIdsByConversation: { 'session:topic:main': ['account-a-skill'] },
    });

    accountScopeResetModule.resetAccountScopedStores('Account changed');

    expect(useSkillStore.getState().installedSkills).toEqual([]);
    expect(useSkillStore.getState().selectedSkillIdsByConversation).toEqual({});
    expect(useSkillStore.getState().isLoading).toBe(true);
  }, 30_000);
});
