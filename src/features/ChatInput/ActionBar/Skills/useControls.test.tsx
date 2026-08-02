import { renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useControls } from './useControls';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  chatState: {
    activeId: 'session-1',
    activeThreadId: 'thread-1',
    activeTopicId: 'topic-1',
  },
  toggleSelectedSkill: vi.fn(),
  useFetchSkills: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.chatState) => unknown) =>
    selector(mocks.chatState),
}));

vi.mock('@/store/skill', () => {
  const state = {
    installedSkills: [
      { identifier: 'reviewer', name: 'Reviewer' },
      { identifier: 'summarizer', name: 'Summarizer' },
    ],
    selectedSkillIdsByConversation: {
      'session-1:topic-1:thread-1': ['reviewer'],
    },
    toggleSelectedSkill: mocks.toggleSelectedSkill,
    useFetchSkills: mocks.useFetchSkills,
  };

  return {
    getSkillSelectionKey: ({ sessionId, threadId, topicId }: Record<string, string>) =>
      `${sessionId}:${topicId}:${threadId}`,
    skillSelectors: {
      selectedSkillIds: (key: string) => (store: typeof state) =>
        store.selectedSkillIdsByConversation[key as keyof typeof store.selectedSkillIdsByConversation] || [],
    },
    useSkillStore: (selector: (store: typeof state) => unknown) => selector(state),
  };
});

vi.mock('../components/CheckbokWithLoading', () => ({
  default: () => null,
}));

describe('Skills composer controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists every globally installed skill and toggles the conversation-scoped selection', async () => {
    const { result } = renderHook(() => useControls());
    const children = result.current[0].children as any[];

    expect(children.map(({ key }) => key)).toEqual(['reviewer', 'summarizer']);
    expect(children[0].label.props.checked).toBe(true);

    await children[1].label.props.onUpdate('summarizer', true);

    expect(mocks.toggleSelectedSkill).toHaveBeenCalledWith(
      'summarizer',
      true,
      'session-1:topic-1:thread-1',
    );
  });
});
