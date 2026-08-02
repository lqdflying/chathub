import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSendMessage } from './useSend';

const mocks = vi.hoisted(() => {
  const chatState = {
    activeId: 'session-1',
    activeSessionType: 'agent' as 'agent' | 'group',
    activeThreadId: undefined as string | undefined,
    activeTopicId: undefined as string | undefined,
    inputMessage: '/reviewer Review this',
    sendGroupMessage: vi.fn(),
    sendMessage: vi.fn(),
    updateInputMessage: vi.fn(),
  };
  const fileState = {
    clearChatUploadFileList: vi.fn(),
    files: [] as any[],
  };
  const skillState = {
    clearSelectedSkills: vi.fn(),
    installedSkills: [{ identifier: 'reviewer' }, { identifier: 'group-reviewer' }],
    selectedSkillIds: [] as string[],
  };

  return {
    chatState,
    checkGeminiChineseWarning: vi.fn().mockResolvedValue(true),
    fileState,
    skillState,
    track: vi.fn(),
  };
});

vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => ({ analytics: { track: mocks.track } }),
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
  useChatStore: Object.assign(
    (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
    { getState: () => mocks.chatState },
  ),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    activeBaseChats: () => [],
    isAIGenerating: () => false,
    isSendButtonDisabledByMessage: () => false,
  },
  topicSelectors: { currentActiveTopic: () => undefined },
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

vi.mock('@/store/session', () => ({
  useSessionStore: { getState: () => ({}) },
}));

vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: { currentGroupAgents: () => [{ skills: ['group-reviewer'] }] },
}));

vi.mock('@/store/skill', () => ({
  getSkillSelectionKey: () => 'session-1:default:main',
  getSkillStoreState: () => mocks.skillState,
  skillSelectors: { selectedSkillIds: () => () => mocks.skillState.selectedSkillIds },
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ user: { id: 'user-1' } }),
}));

describe('V1 mobile skill-aware send hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.activeId = 'session-1';
    mocks.chatState.activeSessionType = 'agent';
    mocks.chatState.inputMessage = '/reviewer Review this';
    mocks.fileState.files = [];
    mocks.skillState.installedSkills = [
      { identifier: 'reviewer' },
      { identifier: 'group-reviewer' },
    ];
    mocks.skillState.selectedSkillIds = [];
  });

  it('sends slash-like input literally without activating a skill', async () => {
    const { result } = renderHook(() => useSendMessage());

    await act(() => result.current.send());

    expect(mocks.chatState.sendMessage).toHaveBeenCalledWith({
      activatedSkillIds: [],
      files: [],
      message: '/reviewer Review this',
    });
    expect(mocks.skillState.clearSelectedSkills).not.toHaveBeenCalled();
    expect(mocks.chatState.updateInputMessage).toHaveBeenCalledWith('');
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ name: 'send_message' }));
  });

  it('sends command-only text as a normal message', async () => {
    mocks.chatState.inputMessage = '/reviewer';
    const { result } = renderHook(() => useSendMessage());

    await act(() => result.current.send());

    expect(mocks.chatState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ activatedSkillIds: [], message: '/reviewer' }),
    );
    expect(mocks.skillState.clearSelectedSkills).not.toHaveBeenCalled();
    expect(mocks.chatState.updateInputMessage).toHaveBeenCalledWith('');
  });

  it('sends group activations as message metadata', async () => {
    mocks.chatState.activeSessionType = 'group';
    mocks.chatState.inputMessage = 'Review this';
    mocks.skillState.selectedSkillIds = ['group-reviewer'];
    const { result } = renderHook(() => useSendMessage());

    await act(() => result.current.send());

    expect(mocks.chatState.sendGroupMessage).toHaveBeenCalledWith({
      files: [],
      groupId: 'session-1',
      message: 'Review this',
      metadata: { skills: { activated: ['group-reviewer'] } },
      onlyAddUserMessage: undefined,
    });
    expect(mocks.chatState.sendMessage).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'send_group_message' }),
    );
  });

  it('includes a skill selected from the composer menu', async () => {
    mocks.chatState.inputMessage = 'Review this';
    mocks.skillState.selectedSkillIds = ['reviewer'];
    const { result } = renderHook(() => useSendMessage());

    await act(() => result.current.send());

    expect(mocks.chatState.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ activatedSkillIds: ['reviewer'], message: 'Review this' }),
    );
    expect(mocks.skillState.clearSelectedSkills).not.toHaveBeenCalled();
  });
});
