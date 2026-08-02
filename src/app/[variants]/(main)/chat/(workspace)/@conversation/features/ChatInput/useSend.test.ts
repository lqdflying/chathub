import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSend, useSendGroupMessage } from './useSend';

const mocks = vi.hoisted(() => {
  const editor = {
    clearContent: vi.fn(),
    focus: vi.fn(),
    setExpand: vi.fn(),
  };
  const chatState = {
    activeId: 'session-1',
    activeThreadId: undefined as string | undefined,
    activeTopicId: undefined as string | undefined,
    addAIMessage: vi.fn(),
    cancelSendMessageInServer: vi.fn(),
    inputMessage: '/reviewer',
    mainInputEditor: editor,
    sendGroupMessage: vi.fn(),
    sendMessage: vi.fn(),
    stopGenerateMessage: vi.fn(),
    updateInputMessage: vi.fn(),
  };
  const fileState = {
    clearChatUploadFileList: vi.fn(),
    files: [] as any[],
  };
  const skillState = {
    clearSelectedSkills: vi.fn(),
    selectedSkillIds: ['reviewer'],
  };

  return {
    chatState,
    checkGeminiChineseWarning: vi.fn().mockResolvedValue(true),
    editor,
    fileState,
    skillState,
  };
});

vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => ({ analytics: { track: vi.fn() } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useGeminiChineseWarning', () => ({
  useGeminiChineseWarning: () => mocks.checkGeminiChineseWarning,
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentModel: () => 'gpt-4',
    currentAgentSkills: () => ['reviewer'],
  },
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: () => mocks.chatState,
  useChatStore: Object.assign(
    (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
    { getState: () => mocks.chatState },
  ),
}));

vi.mock('@/store/chat/selectors', () => ({
  aiChatSelectors: {
    isCurrentPreSendCompacting: () => false,
    isCurrentSendMessageLoading: () => false,
  },
  chatSelectors: {
    activeBaseChats: () => [],
    isAIGenerating: () => false,
    isCreatingMessage: () => false,
    isSendButtonDisabledByMessage: () => false,
    isSupervisorLoading: () => () => false,
  },
  topicSelectors: {
    currentActiveTopic: () => undefined,
  },
}));

vi.mock('@/store/file', () => ({
  fileChatSelectors: {
    chatUploadFileList: (state: typeof mocks.fileState) => state.files,
    isUploadingFiles: () => false,
  },
  useFileStore: Object.assign(
    (selector: (state: typeof mocks.fileState) => unknown) => selector(mocks.fileState),
    { getState: () => mocks.fileState },
  ),
}));

vi.mock('@/store/mention', () => ({
  mentionSelectors: { mentionedUsers: () => [] },
  useMentionStore: { getState: () => ({ clearMentionedUsers: vi.fn() }) },
}));

vi.mock('@/store/session', () => ({
  useSessionStore: Object.assign(
    (selector: (state: object) => unknown) => selector({}),
    { getState: () => ({}) },
  ),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionMetaSelectors: { getAgentMetaByAgentId: () => () => ({}) },
  sessionSelectors: { currentGroupAgents: () => [{ skills: ['reviewer'] }] },
}));

vi.mock('@/store/skill', () => ({
  getSkillSelectionKey: () => 'session-1:main',
  getSkillStoreState: () => mocks.skillState,
  skillSelectors: { selectedSkillIds: () => () => mocks.skillState.selectedSkillIds },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ user: { id: 'user-1' } }),
}));

describe('workspace skill-aware send hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.inputMessage = '/reviewer';
    mocks.fileState.files = [];
    mocks.skillState.selectedSkillIds = ['reviewer'];
  });

  it('preserves a command-only draft in single-agent chat', async () => {
    const { result } = renderHook(() => useSend());

    await act(() => result.current.send());

    expect(mocks.chatState.sendMessage).not.toHaveBeenCalled();
    expect(mocks.skillState.clearSelectedSkills).not.toHaveBeenCalled();
    expect(mocks.fileState.clearChatUploadFileList).not.toHaveBeenCalled();
    expect(mocks.editor.clearContent).not.toHaveBeenCalled();
  });

  it('allows a command-only activation when a file is attached', async () => {
    mocks.fileState.files = [{ id: 'file-1' }];
    const { result } = renderHook(() => useSend());

    await act(() => result.current.send());

    expect(mocks.chatState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ activatedSkillIds: ['reviewer'], message: '' }),
    );
    expect(mocks.skillState.clearSelectedSkills).toHaveBeenCalledWith('session-1:main');
    expect(mocks.editor.clearContent).toHaveBeenCalled();
  });

  it('preserves a command-only draft in group chat', async () => {
    const { result } = renderHook(() => useSendGroupMessage());

    await act(() => result.current.send());

    expect(mocks.chatState.sendGroupMessage).not.toHaveBeenCalled();
    expect(mocks.skillState.clearSelectedSkills).not.toHaveBeenCalled();
    expect(mocks.fileState.clearChatUploadFileList).not.toHaveBeenCalled();
    expect(mocks.editor.clearContent).not.toHaveBeenCalled();
    expect(mocks.chatState.updateInputMessage).not.toHaveBeenCalled();
  });
});
