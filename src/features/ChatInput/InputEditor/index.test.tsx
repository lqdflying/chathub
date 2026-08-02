import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InputEditor from './index';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  chatState: {
    activeId: 'session-1',
    activeSessionType: 'agent',
    activeThreadId: 'thread-1',
    activeTopicId: 'topic-1',
  },
  editorProps: undefined as any,
  enableSkills: true,
  toggleSelectedSkill: vi.fn(),
}));

vi.mock('@lobehub/editor', () => ({
  INSERT_MENTION_COMMAND: 'insert-mention',
  INSERT_TABLE_COMMAND: 'insert-table',
  ReactCodePlugin: {},
  ReactCodeblockPlugin: {},
  ReactHRPlugin: {},
  ReactLinkHighlightPlugin: {},
  ReactListPlugin: {},
  ReactMathPlugin: {},
  ReactTablePlugin: {},
}));

vi.mock('@lobehub/editor/react', () => {
  const Editor = Object.assign(
    (props: any) => {
      mocks.editorProps = props;
      return null;
    },
    { withProps: (plugin: unknown) => plugin },
  );

  return {
    Editor,
    FloatMenu: () => null,
    SlashMenu: () => null,
    useEditorState: () => ({ isEmpty: true }),
  };
});

vi.mock('@lobehub/ui', () => ({ combineKeys: () => 'hotkey' }));

vi.mock('antd-style', () => ({
  css: () => '',
  cx: (...classNames: string[]) => classNames.join(' '),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeysContext: () => ({ disableScope: vi.fn(), enableScope: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentSkills: () => ['reviewer'] },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
    { getState: () => mocks.chatState },
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: () => ({ enableSkills: mocks.enableSkills }),
  useServerConfigStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: { currentGroupAgents: () => [] },
}));

vi.mock('@/store/skill', () => {
  const skillState = {
    installedSkills: [
      { description: 'Review code carefully.', identifier: 'reviewer', name: 'Reviewer' },
    ],
    toggleSelectedSkill: mocks.toggleSelectedSkill,
  };

  return {
    getSkillSelectionKey: ({ sessionId, threadId, topicId }: Record<string, string>) =>
      `${sessionId}:${topicId}:${threadId}`,
    useSkillStore: Object.assign(
      (selector: (state: typeof skillState) => unknown) => selector(skillState),
      { getState: () => skillState },
    ),
  };
});

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    inputMarkdownRender: () => false,
    useCmdEnterToSend: () => false,
  },
  settingsSelectors: { getHotkeyById: () => () => 'enter' },
}));

vi.mock('../store', () => ({
  useChatInputStore: (selector: (state: object) => unknown) =>
    selector({
      editor: {},
      expand: false,
      handleSendButton: vi.fn(),
      mentionItems: undefined,
      slashMenuRef: { current: null },
      updateMarkdownContent: vi.fn(),
    }),
  useStoreApi: () => ({ setState: vi.fn() }),
}));

vi.mock('./Placeholder', () => ({ default: () => null }));
vi.mock('./ReplacementTextPlugin', () => ({ default: () => null }));

describe('InputEditor skill slash items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editorProps = undefined;
    mocks.enableSkills = true;
  });

  it('toggles the scoped selection without rewriting the editor document', () => {
    render(<InputEditor />);
    const skillItem = mocks.editorProps.slashOption.items.find(
      (item: { key: string }) => item.key === 'reviewer',
    );
    const editor = { focus: vi.fn(), setDocument: vi.fn() };

    act(() => skillItem.onSelect(editor));

    expect(mocks.toggleSelectedSkill).toHaveBeenCalledWith(
      'reviewer',
      true,
      'session-1:topic-1:thread-1',
    );
    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalled();
  });

  it('omits skill slash items when the feature is disabled', () => {
    mocks.enableSkills = false;

    render(<InputEditor />);

    expect(
      mocks.editorProps.slashOption.items.some(
        (item: { key: string }) => item.key === 'reviewer',
      ),
    ).toBe(false);
  });
});
