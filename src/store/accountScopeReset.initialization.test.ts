import { describe, expect, it, vi } from 'vitest';

describe('accountScopeReset module initialization', () => {
  it('initializes account-scoped stores from a fresh module graph', async () => {
    vi.resetModules();

    const accountScopeResetModule = await import('./accountScopeReset');
    const { useSkillStore } = await import('./skill');
    const { MAIN_PASTED_TEXT_SCOPE } = await import('@/features/ChatInput/pastedText/scope');
    const { usePastedTextStore } = await import('@/features/ChatInput/pastedText/store');

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
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'account dump');

    accountScopeResetModule.resetAccountScopedStores('Account changed');

    expect(useSkillStore.getState().installedSkills).toEqual([]);
    expect(useSkillStore.getState().selectedSkillIdsByConversation).toEqual({});
    expect(useSkillStore.getState().isLoading).toBe(true);
    expect(usePastedTextStore.getState().itemsByScope).toEqual({});
  }, 30_000);
});
