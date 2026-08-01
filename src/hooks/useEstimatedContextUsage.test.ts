import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEstimatedContextUsage } from './useEstimatedContextUsage';

const mocks = vi.hoisted(() => {
  const mainChats = [{ content: 'main-chat-context', id: 'main-message' }];
  const portalChats = [
    { content: 'old-portal-context', id: 'portal-message-1' },
    { content: 'recent-portal-context', id: 'portal-message-2' },
    { content: 'latest-portal-context', id: 'portal-message-3' },
  ];
  const chatState = {
    inputMessage: '',
  };
  let agentState = {
    enableHistoryCount: true,
    historyCount: 2,
  };
  const agentListeners = new Set<() => void>();
  const useChatStore = Object.assign(
    vi.fn((selector?: (state: typeof chatState) => unknown) =>
      selector ? selector(chatState) : chatState,
    ),
    {
      getState: vi.fn(() => chatState),
    },
  );
  const useToolStore = vi.fn((selector?: (state: object) => unknown) =>
    selector ? selector({}) : {},
  );
  const useUserStore = vi.fn((selector?: () => unknown) => (selector ? selector() : {}));

  return {
    getAgentState: () => agentState,
    mainChats,
    portalChats,
    setAgentState: (nextState: typeof agentState) => {
      agentState = nextState;
      agentListeners.forEach((listener) => listener());
    },
    subscribeAgent: (listener: () => void) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    useChatStore,
    useToolStore,
    useUserStore,
  };
});

vi.mock('@/store/chat', () => ({ useChatStore: mocks.useChatStore }));
vi.mock('@/store/agent', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import('react')>('react');
  const useAgentStore = (selector?: (state: ReturnType<typeof mocks.getAgentState>) => unknown) => {
    const state = useSyncExternalStore(
      mocks.subscribeAgent,
      mocks.getAgentState,
      mocks.getAgentState,
    );

    return selector ? selector(state) : state;
  };

  return { useAgentStore };
});
vi.mock('@/store/tool', () => ({ useToolStore: mocks.useToolStore }));
vi.mock('@/store/user', () => ({ useUserStore: mocks.useUserStore }));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainAIChats: () => mocks.mainChats,
  },
  threadSelectors: {
    portalAIChats: () => mocks.portalChats,
  },
  topicSelectors: {
    currentActiveTopic: () => undefined,
    currentActiveTopicSummary: () => undefined,
  },
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: () => ({
      enableCompressHistory: false,
      enableUserMemoryArchive: false,
    }),
    enableAssistantMemory: () => true,
    enableHistoryCount: (state: ReturnType<typeof mocks.getAgentState>) => state.enableHistoryCount,
    historyCount: (state: ReturnType<typeof mocks.getAgentState>) => state.historyCount,
  },
  agentSelectors: {
    currentAgentConfig: () => ({ assistantMemory: '' }),
    currentAgentModel: () => 'test-model',
    currentAgentModelProvider: () => 'openai',
    currentAgentPlugins: () => [],
    currentAgentSystemRole: () => 'system role',
  },
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: {
    enabledSystemRoles: () => () => '',
  },
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    generalInstruction: () => 'chat instruction',
  },
}));

vi.mock('@/helpers/memoryArchivePrompt', () => ({
  buildHistorySummaryForRequest: () => '',
}));

vi.mock('@/helpers/toolEngineering', () => ({
  createChatToolsEngine: () => ({
    generateToolsDetailed: () => ({ enabledToolIds: [], tools: [] }),
  }),
}));

vi.mock('@/hooks/useModelContextWindowTokens', () => ({
  useModelContextWindowTokens: () => 1000,
}));

vi.mock('@/hooks/useModelSupportToolUse', () => ({
  useModelSupportToolUse: () => true,
}));

vi.mock('@/hooks/useTokenCount', () => ({
  useTokenCount: (value = '') => value.length,
}));

vi.mock('@/services/chat/composeSystemRole', () => ({
  composeSystemRole: (instruction: string, role: string) => `${instruction}${role}`,
}));

describe('useEstimatedContextUsage', () => {
  it('uses portal conversation content instead of main-chat content', () => {
    const { result } = renderHook(() => useEstimatedContextUsage('portal'));

    expect(result.current.chatsToken).toBe('recent-portal-contextlatest-portal-context'.length);
  });

  it('recalculates portal allocation when only the history limit changes', () => {
    const { result } = renderHook(() => useEstimatedContextUsage('portal'));

    expect(result.current.chatsToken).toBe('recent-portal-contextlatest-portal-context'.length);

    act(() => {
      mocks.setAgentState({
        enableHistoryCount: true,
        historyCount: 1,
      });
    });

    expect(result.current.chatsToken).toBe('latest-portal-context'.length);
  });
});
