import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyUserInputTemplate } from '@lobechat/context-engine';

import {
  LARGE_CONTEXT_WINDOW_TOKENS,
  appendPendingUserInputForContextWindow,
  getHistoryWindowDiagnostics,
  resolveEffectiveHistoryWindow,
  serializeMessagesForContextEstimate,
} from '@/helpers/contextUsageEstimate';

import { useEstimatedContextUsage } from './useEstimatedContextUsage';

const mocks = vi.hoisted(() => {
  const mainChats = [{ content: 'main-chat-context', id: 'main-message', role: 'user' }];
  const portalChats = [
    { content: 'old-portal-context', id: 'portal-message-1', role: 'user' },
    { content: 'recent-portal-context', id: 'portal-message-2', role: 'assistant' },
    { content: 'latest-portal-context', id: 'portal-message-3', role: 'user' },
  ];
  const chatState = {
    activeId: 'session-1',
    activeTopicId: 'topic-1',
    inputMessage: '',
    knowledgeBaseContextTokens: {
      '[1,"session-1","topic-1"]': 37,
    },
  };
  let agentState = {
    enableCompressHistory: false,
    enableHistoryCount: true,
    historyCount: 2,
    inputTemplate: '',
  };
  let topicMetadata: {
    historySummaryLastMessageId?: string;
    memoryDebugLog?: Array<{ at: number; status?: string }>;
  } = {};
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
  let hasPendingFiles = false;
  const useFileStore = vi.fn((selector?: (state: { hasPendingFiles: boolean }) => unknown) =>
    selector ? selector({ hasPendingFiles }) : { hasPendingFiles },
  );

  return {
    chatState,
    getAgentState: () => agentState,
    hasPendingFiles: () => hasPendingFiles,
    mainChats,
    maxTokens: 1000,
    portalChats,
    setHasPendingFiles: (value: boolean) => {
      hasPendingFiles = value;
    },
    setTopicMetadata: (value: typeof topicMetadata) => {
      topicMetadata = value;
    },
    topicMetadata: () => topicMetadata,
    setAgentState: (nextState: Partial<typeof agentState>) => {
      agentState = { ...agentState, ...nextState };
      agentListeners.forEach((listener) => listener());
    },
    subscribeAgent: (listener: () => void) => {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    useChatStore,
    useFileStore,
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
vi.mock('@/store/file/store', () => ({ useFileStore: mocks.useFileStore }));
vi.mock('@/store/file/slices/chat/selectors', () => ({
  fileChatSelectors: {
    chatUploadFileListHasItem: (state: { hasPendingFiles: boolean }) => state.hasPendingFiles,
  },
}));
vi.mock('@/store/user', () => ({ useUserStore: mocks.useUserStore }));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainAIChats: () => mocks.mainChats,
  },
  threadSelectors: {
    portalAIChats: () => mocks.portalChats,
  },
  topicSelectors: {
    currentActiveTopic: () => ({ metadata: mocks.topicMetadata() }),
    currentActiveTopicSummary: () => undefined,
  },
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: (state: ReturnType<typeof mocks.getAgentState>) => ({
      enableCompressHistory: state.enableCompressHistory,
      enableUserMemoryArchive: false,
      inputTemplate: state.inputTemplate,
    }),
    enableAssistantMemory: () => true,
    enableHistoryCount: (state: ReturnType<typeof mocks.getAgentState>) => state.enableHistoryCount,
    enableUserMemoryArchive: () => false,
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
  useModelContextWindowTokens: () => mocks.maxTokens,
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
  beforeEach(() => {
    mocks.chatState.inputMessage = '';
    mocks.maxTokens = 1000;
    mocks.setHasPendingFiles(false);
    mocks.mainChats.splice(0, mocks.mainChats.length, {
      content: 'main-chat-context',
      id: 'main-message',
      role: 'user',
    });
    mocks.setTopicMetadata({});
    mocks.setAgentState({
      enableCompressHistory: false,
      enableHistoryCount: true,
      historyCount: 2,
      inputTemplate: '',
    });
  });
  it('includes the active Knowledge Base request bucket in total usage', () => {
    const { result } = renderHook(() => useEstimatedContextUsage('main'));

    expect(result.current.knowledgeBaseToken).toBe(37);
    expect(result.current.totalToken).toBe(
      result.current.systemRoleToken +
        result.current.memoryToken +
        result.current.historySummaryToken +
        result.current.toolsToken +
        result.current.chatsToken +
        37,
    );
    expect(result.current.historyWindow.topicMessageCount).toBe(1);
  });

  it('uses portal conversation content instead of main-chat content', () => {
    const { result } = renderHook(() => useEstimatedContextUsage('portal'));
    const expected = serializeMessagesForContextEstimate([
      mocks.portalChats[1],
      mocks.portalChats[2],
    ] as any);

    expect(result.current.chatsToken).toBe(expected.length);
  });

  it('recalculates portal allocation when only the history limit changes', () => {
    const { result } = renderHook(() => useEstimatedContextUsage('portal'));

    act(() => {
      mocks.setAgentState({
        enableHistoryCount: true,
        historyCount: 1,
      });
    });

    const expected = serializeMessagesForContextEstimate([mocks.portalChats[2]] as any);
    expect(result.current.chatsToken).toBe(expected.length);
  });

  it('counts a duplicating pending-input template in the next-request history window', () => {
    const pending = 'x'.repeat(80_000);
    mocks.chatState.inputMessage = pending;
    mocks.maxTokens = LARGE_CONTEXT_WINDOW_TOKENS;
    mocks.setAgentState({
      enableHistoryCount: true,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
    });

    const storedOnly = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: mocks.mainChats as any,
    });
    const nextRequest = appendPendingUserInputForContextWindow(
      mocks.mainChats as any,
      pending,
    );
    const expected = resolveEffectiveHistoryWindow({
      enableHistoryCount: true,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messagesAfterCursor: nextRequest,
    });
    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    const diagnostics = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messages: mocks.mainChats as any,
      pendingInput: pending,
    });

    expect(storedOnly.enableHistoryCount).toBe(false);
    expect(expected.enableHistoryCount).toBe(true);
    expect(result.current.historyWindow.enableHistoryCount).toBe(expected.enableHistoryCount);
    expect(result.current.historyWindow.expanded).toBe(expected.expanded);
    expect(result.current.historyWindow.topicMessageCount).toBe(diagnostics.topicMessageCount);
    expect(result.current.inputTokenCount).toBe(
      applyUserInputTemplate('{{text}}{{text}}', pending).length,
    );
  });

  it('counts a prefix/suffix pending-input template once', () => {
    const pending = 'hello world';
    mocks.chatState.inputMessage = pending;
    mocks.setAgentState({ inputTemplate: 'Ask: {{text}}' });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    const templated = applyUserInputTemplate('Ask: {{text}}', pending);

    expect(result.current.inputTokenCount).toBe(templated.length);
    expect(result.current.chatsToken).toBeGreaterThan(
      serializeMessagesForContextEstimate(mocks.mainChats as any, 'Ask: {{text}}').length,
    );
    expect(result.current.chatsToken).toBe(
      serializeMessagesForContextEstimate(
        appendPendingUserInputForContextWindow(mocks.mainChats as any, pending),
        'Ask: {{text}}',
      ).length,
    );
  });

  it('does not invent a pending user row for empty input', () => {
    mocks.chatState.inputMessage = '';
    mocks.maxTokens = LARGE_CONTEXT_WINDOW_TOKENS;
    mocks.setAgentState({ inputTemplate: '{{text}}{{text}}' });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    const expected = getHistoryWindowDiagnostics({
      configuredHistoryCount: 2,
      enableHistoryCount: true,
      hasTopicSummary: false,
      historyCount: 2,
      inputTemplate: '{{text}}{{text}}',
      maxTokens: LARGE_CONTEXT_WINDOW_TOKENS,
      messages: mocks.mainChats as any,
    });

    expect(result.current.inputTokenCount).toBe(0);
    expect(result.current.historyWindow.enableHistoryCount).toBe(expected.enableHistoryCount);
    expect(result.current.historyWindow.topicMessageCount).toBe(1);
  });

  it('counts file-only pending sends with the input template once', () => {
    mocks.chatState.inputMessage = '';
    mocks.setHasPendingFiles(true);
    mocks.setAgentState({ inputTemplate: 'Ask: {{text}}' });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    const templatedEmpty = applyUserInputTemplate('Ask: {{text}}', '');

    expect(result.current.inputTokenCount).toBe(templatedEmpty.length);
    expect(result.current.chatsToken).toBe(
      serializeMessagesForContextEstimate(
        appendPendingUserInputForContextWindow(mocks.mainChats as any, '', true),
        'Ask: {{text}}',
      ).length,
    );
  });

  it('floors total usage with the latest provider-reported input tokens', () => {
    mocks.mainChats.splice(
      0,
      mocks.mainChats.length,
      { content: 'hi', id: 'u1', role: 'user' } as never,
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as never,
    );

    const { result } = renderHook(() => useEstimatedContextUsage('main'));

    expect(result.current.totalToken).toBe(50_000);
  });

  it('does not floor with provider usage recorded before the latest compaction', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.mainChats.splice(
      0,
      mocks.mainChats.length,
      { content: 'old', id: 'u1', role: 'user' } as never,
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 1000,
      } as never,
      { content: 'hi', id: 'u2', role: 'user' } as never,
      {
        content: 'ok',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 1000,
      } as never,
    );

    const before = renderHook(() => useEstimatedContextUsage('main'));
    expect(before.result.current.totalToken).toBe(1_048_570);
    before.unmount();

    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      memoryDebugLog: [{ at: 5000, status: 'compacted' }],
    });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeLessThan(1_048_570);
  });
});
