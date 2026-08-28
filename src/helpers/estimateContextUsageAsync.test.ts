import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapHistorySummaryForTokenEstimate } from './contextUsageEstimate';
import { estimateContextUsageAsync } from './estimateContextUsageAsync';

vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: vi.fn(async (text: string) => text.length),
}));

vi.mock('@/helpers/assistantMemory', () => ({
  normalizeAssistantMemoryText: (value: string) => value,
}));

vi.mock('@/helpers/memoryArchivePrompt', () => ({
  buildHistorySummaryForRequest: () => 'history-summary-text',
}));

vi.mock('@/helpers/modelContextWindowTokens', () => ({
  getModelContextWindowTokens: () => 8000,
}));

vi.mock('@/helpers/toolEngineering', () => ({
  createChatToolsEngine: () => ({
    generateToolsDetailed: () => ({
      enabledToolIds: ['tool-1'],
      tools: [{ function: { name: 'search' } }],
    }),
  }),
}));

vi.mock('@/services/chat/composeSystemRole', () => ({
  composeSystemRole: () => 'system-role-text',
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: () => ({ enableCompressHistory: true, enableUserMemoryArchive: false }),
    enableAssistantMemory: () => false,
    enableHistoryCount: () => true,
    historyCount: () => 20,
  },
  agentSelectors: {
    currentAgentConfig: () => ({}),
    currentAgentModel: () => 'gpt-5-mini',
    currentAgentModelProvider: () => 'openai',
    currentAgentPlugins: () => [],
    currentAgentSystemRole: () => 'agent-role',
  },
}));

vi.mock('@/store/agent/store', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelSupportToolUse: () => () => true,
  },
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainAIChats: () => [{ content: 'chat-text', id: 'u1', role: 'user' }],
  },
  topicSelectors: {
    currentActiveTopic: () => ({ metadata: {} }),
    currentActiveTopicSummary: () => ({ content: 'summary' }),
  },
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: {
    enabledSystemRoles: () => () => 'plugin-system-role',
  },
}));

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => ({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    generalInstruction: () => '',
  },
}));

vi.mock('@/store/user/store', () => ({
  getUserStoreState: () => ({}),
}));

describe('estimateContextUsageAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns systemRole, tools, and input token parts alongside the total', async () => {
    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: 'input-text' } as any,
    });

    expect(result.systemRoleToken).toBe('system-role-text'.length);
    expect(result.toolsToken).toBeGreaterThan(0);
    expect(result.inputToken).toBe('input-text'.length);
    expect(result.chatsToken).toBe('user:\nchat-text'.length);
    expect(result.historySummaryToken).toBe(
      wrapHistorySummaryForTokenEstimate('history-summary-text').length,
    );
    expect(result.totalToken).toBe(
      result.systemRoleToken +
        result.memoryToken +
        result.historySummaryToken +
        result.toolsToken +
        result.chatsToken +
        result.inputToken,
    );
  });
});
