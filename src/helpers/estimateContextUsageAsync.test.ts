import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wrapHistorySummaryForTokenEstimate } from './contextUsageEstimate';
import { estimateContextUsageAsync } from './estimateContextUsageAsync';

const mocks = vi.hoisted(() => ({
  chats: [{ content: 'chat-text', id: 'u1', role: 'user' }] as Array<{
    content: string;
    id: string;
    role: string;
    tool_call_id?: string;
  }>,
  historyCount: 20,
}));

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
    historyCount: () => mocks.historyCount,
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
    mainAIChats: () => mocks.chats,
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
    mocks.historyCount = 20;
    mocks.chats = [{ content: 'chat-text', id: 'u1', role: 'user' }];
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

  it('keeps the HistoryTruncate setting separate from continuation-extended included rows', async () => {
    mocks.historyCount = 2;
    mocks.chats = [
      { content: 'u1', id: 'u1', role: 'user' },
      { content: 'a1', id: 'a1', role: 'assistant' },
      { content: 'u2', id: 'u2', role: 'user' },
      { content: 'a2', id: 'a2', role: 'assistant' },
      { content: 'u3', id: 'u3', role: 'user' },
      { content: 'a3', id: 'a3', role: 'assistant' },
      { content: 'tool3', id: 'tool3', role: 'tool', tool_call_id: 'tc3' },
    ];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.effectiveHistoryCount).toBe(2);
    expect(result.includedMessageCount).toBe(4);
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['a2', 'u3', 'a3', 'tool3']);
  });
});
