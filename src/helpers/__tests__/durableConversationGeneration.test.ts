import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDurableConversationConfig,
  isClientDurableConversationGenerationEnabled,
} from '../durableConversationGeneration';

describe('buildDurableConversationConfig', () => {
  it('captures the complete non-secret request state and deduplicates skills', () => {
    expect(
      buildDurableConversationConfig({
        activatedSkillIds: ['skill-a', 'skill-a', 'skill-b'],
        agentConfig: {
          chatConfig: { enableReasoning: false },
          model: 'model-a',
          params: { max_tokens: 4096, temperature: 0.2 },
          plugins: ['plugin-a'],
          provider: 'provider-a',
          systemRole: 'agent role',
        },
        chatConfig: { enableReasoning: true, searchMode: 'auto' },
        enableMemoryTool: true,
        fetchOnClient: false,
        historySummary: 'summary',
        historySummaryLastMessageId: 'message-2',
        isWelcomeQuestion: true,
        locale: 'zh-CN',
        ragQuery: 'query',
        systemRole: 'resolved role',
      }),
    ).toEqual({
      activatedSkillIds: ['skill-a', 'skill-b'],
      agentParams: { max_tokens: 4096, temperature: 0.2 },
      chatConfig: { enableReasoning: true, searchMode: 'auto' },
      enableMemoryTool: true,
      fetchOnClient: false,
      historySummary: 'summary',
      historySummaryLastMessageId: 'message-2',
      isWelcomeQuestion: true,
      locale: 'zh-CN',
      model: 'model-a',
      plugins: ['plugin-a'],
      provider: 'provider-a',
      ragQuery: 'query',
      systemRole: 'resolved role',
    });
  });

  it('uses the agent chat config and system role when no resolved override is provided', () => {
    expect(
      buildDurableConversationConfig({
        agentConfig: {
          chatConfig: { searchMode: 'off' },
          model: 'model-a',
          provider: 'provider-a',
          systemRole: 'agent role',
        },
      }),
    ).toMatchObject({
      chatConfig: { searchMode: 'off' },
      systemRole: 'agent role',
    });
  });
});

describe('isClientDurableConversationGenerationEnabled', () => {
  afterEach(() => {
    delete (window as any).global_serverConfigStore;
  });

  it('is false when the server config store is missing', () => {
    expect(isClientDurableConversationGenerationEnabled()).toBe(false);
  });

  it('reads only the hydrated server feature flag', () => {
    (window as any).global_serverConfigStore = {
      getState: () => ({
        featureFlags: { enableDurableConversationGeneration: true },
      }),
    };

    expect(isClientDurableConversationGenerationEnabled()).toBe(true);
  });
});
