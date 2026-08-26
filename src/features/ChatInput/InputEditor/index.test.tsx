import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InputEditor from './index';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  editorProps: undefined as any,
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
  useLexicalEditor: () => {},
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

describe('InputEditor slash items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editorProps = undefined;
  });

  it('keeps editor commands without exposing installed skills', () => {
    render(<InputEditor />);

    expect(
      mocks.editorProps.slashOption.items.some((item: { key: string }) => item.key === 'reviewer'),
    ).toBe(false);
    expect(
      mocks.editorProps.slashOption.items.some((item: { key: string }) => item.key === 'table'),
    ).toBe(true);
  });
});
