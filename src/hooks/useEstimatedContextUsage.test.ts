import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyUserInputTemplate } from '@lobechat/context-engine';

import { LOADING_FLAT } from '@/const/message';
import {
  LARGE_CONTEXT_WINDOW_TOKENS,
  appendPendingUserInputForContextWindow,
  getHistoryWindowDiagnostics,
  resolveEffectiveHistoryWindow,
  serializeMessagesForContextEstimate,
} from '@/helpers/contextUsageEstimate';
import { clearAnchorBaselines } from '@/helpers/reportedContextTokens';

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
    reportedInputTokenFloorAfterMessageId?: string;
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
    systemRole: 'system role',
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
    currentAgentSystemRole: () => mocks.systemRole,
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
    clearAnchorBaselines();
    mocks.systemRole = 'system role';
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

  /**
   * D2/T1: land a report on a final assistant row the way the real flow does —
   * render the settled pre-send conversation (records the pre-request witness),
   * rerender with the row in flight (freezes the request witness keyed by its
   * parent), then rerender with the report so the estimate can promote the
   * witness to a baseline.
   */
  const renderReportLanding = (
    settledPrefix: Array<Record<string, unknown>>,
    settledLastRow: Record<string, unknown>,
  ) => {
    mocks.mainChats.splice(0, mocks.mainChats.length, ...(settledPrefix as never[]));
    const view = renderHook(() => useEstimatedContextUsage('main'));
    mocks.mainChats.push({ ...settledLastRow, content: LOADING_FLAT, metadata: undefined } as never);
    view.rerender();
    mocks.mainChats.splice(mocks.mainChats.length - 1, 1, settledLastRow as never);
    view.rerender();
    return view;
  };
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

  it('anchors total usage on the latest provider-reported input tokens plus the tail', () => {
    const { result } = renderReportLanding(
      [{ content: 'hi', id: 'u1', role: 'user' }],
      { content: 'ok', id: 'a1', metadata: { totalInputTokens: 50_000 }, role: 'assistant' },
    );

    expect(result.current.totalToken).toBe(50_050);
  });

  it('does not anchor on the protected assistant after an identity watermark, even if updatedAt is newer', () => {
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
        updatedAt: 9000,
      } as never,
    );
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeLessThan(1_048_570);
  });

  it('anchors a later assistant even when that row has older timestamps than the protected turn', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'hi', id: 'u2', role: 'user' },
        {
          content: 'protected',
          id: 'a2',
          metadata: { totalInputTokens: 1_048_570 },
          role: 'assistant',
          updatedAt: 9000,
        },
        { content: 'next', id: 'u3', role: 'user' },
      ],
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 400 },
        role: 'assistant',
        updatedAt: 50,
      },
    );

    expect(result.current.totalToken).toBe(453);
  });

  it('does not anchor on a protected assistant when a cursor exists without a watermark', () => {
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
      } as never,
      { content: 'hi', id: 'u2', role: 'user' } as never,
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      } as never,
    );
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
    });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeLessThan(1_048_570);
  });

  it('does not revive older usage after the watermark row is deleted', () => {
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
      } as never,
      { content: 'hi', id: 'u2', role: 'user' } as never,
      {
        content: 'older-protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      } as never,
      { content: 'later', id: 'u3', role: 'user' } as never,
    );
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'deleted-a3',
    });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeLessThan(1_048_570);
  });

  it('does not anchor on a request that straddled compaction after the placeholder finalizes', () => {
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
        metadata: { totalInputTokens: 800 },
        role: 'assistant',
      } as never,
      { content: 'hi', id: 'u2', role: 'user' } as never,
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      } as never,
      {
        content: 'final',
        id: 'a3',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      } as never,
    );
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a3',
    });

    const { result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeLessThan(1_048_570);
  });

  it('anchors a later assistant after a persisted migration boundary', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'hi', id: 'u2', role: 'user' },
        { content: 'protected', id: 'a2', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'next', id: 'u3', role: 'user' },
      ],
      { content: 'fresh', id: 'a3', metadata: { totalInputTokens: 700_000 }, role: 'assistant' },
    );

    expect(result.current.totalToken).toBe(700_053);
  });

  it('anchors a selected assistant when historyCount drops the stored marker', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 1,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'hi', id: 'u2', role: 'user' },
        { content: 'protected', id: 'a2', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'next', id: 'u3', role: 'user' },
      ],
      { content: 'fresh', id: 'a3', metadata: { totalInputTokens: 700_000 }, role: 'assistant' },
    );

    expect(result.current.historyWindow.includedMessageCount).toBe(2);
    expect(result.current.totalToken).toBe(700_053);
  });

  it('anchors a new assistant after the deleted marker is rotated', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a2',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'hi', id: 'u2', role: 'user' },
        { content: 'older-protected', id: 'a2', metadata: { totalInputTokens: 1_048_570 }, role: 'assistant' },
        { content: 'later', id: 'u3', role: 'user' },
      ],
      { content: 'fresh', id: 'a4', metadata: { totalInputTokens: 700_000 }, role: 'assistant' },
    );

    expect(result.current.totalToken).toBe(700_053);
  });

  it('anchors a post-compaction assistant after a user-only remaining window', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'u3',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 800 }, role: 'assistant' },
        { content: 'hi', id: 'u3', role: 'user' },
      ],
      { content: 'fresh', id: 'a3', metadata: { totalInputTokens: 700_000 }, role: 'assistant' },
    );

    expect(result.current.totalToken).toBe(700_053);
  });

  it('anchors a fresh assistant after the sole post-cursor watermark is replaced by the cursor', () => {
    mocks.setAgentState({
      enableCompressHistory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: '',
    });
    mocks.setTopicMetadata({
      historySummaryLastMessageId: 'a1',
      reportedInputTokenFloorAfterMessageId: 'a1',
    });

    const { result } = renderReportLanding(
      [
        { content: 'old', id: 'u1', role: 'user' },
        { content: 'old-a', id: 'a1', metadata: { totalInputTokens: 800 }, role: 'assistant' },
        { content: 'next', id: 'u4', role: 'user' },
      ],
      { content: 'fresh', id: 'a4', metadata: { totalInputTokens: 700_000 }, role: 'assistant' },
    );

    expect(result.current.totalToken).toBe(700_053);
  });

  it('T1: does not register instructions changed while the reply is pending as its baseline', () => {
    // Pre-send settled render (witness), then the in-flight render freezes it.
    mocks.mainChats.splice(0, mocks.mainChats.length, {
      content: 'hi',
      id: 'hook-u1',
      role: 'user',
    } as never);
    const { rerender, result } = renderHook(() => useEstimatedContextUsage('main'));
    mocks.mainChats.push({ content: LOADING_FLAT, id: 'hook-a1', role: 'assistant' } as never);
    rerender();

    // Editing instructions mid-generation must not be certified by the pending
    // request's report.
    mocks.systemRole = 'x'.repeat(20_000);
    rerender();
    expect(result.current.totalToken).toBeGreaterThan(20_000);

    mocks.mainChats.splice(1, 1, {
      content: 'ok',
      id: 'hook-a1',
      metadata: { totalInputTokens: 1000 },
      role: 'assistant',
    } as never);
    rerender();

    // Anchored on the frozen witness: 1000 report + instruction-overhead delta
    // + tail — never the ~1,050 undercount from certifying the new instructions.
    expect(result.current.totalToken).toBeGreaterThanOrEqual(10_000);
  });

  it('T1: reload into an already-running request falls back to the whole window', () => {
    // The FIRST render of this process already sees the in-flight row: no
    // pre-request witness exists, so the arriving report can never promote.
    mocks.systemRole = 'x'.repeat(20_000);
    mocks.mainChats.splice(
      0,
      mocks.mainChats.length,
      { content: 'hi', id: 'hook-u1', role: 'user' } as never,
      { content: LOADING_FLAT, id: 'hook-a1', role: 'assistant' } as never,
    );
    const { rerender, result } = renderHook(() => useEstimatedContextUsage('main'));
    expect(result.current.totalToken).toBeGreaterThan(20_000);

    mocks.mainChats.splice(1, 1, {
      content: 'ok',
      id: 'hook-a1',
      metadata: { totalInputTokens: 1000 },
      role: 'assistant',
    } as never);
    rerender();

    expect(result.current.totalToken).toBeGreaterThanOrEqual(10_000);
  });
});
