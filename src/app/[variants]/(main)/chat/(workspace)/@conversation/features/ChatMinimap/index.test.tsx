import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const selectors = vi.hoisted(() => ({
  seen: [] as Array<(state: any) => unknown>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({ cx: (...args: unknown[]) => args.filter(Boolean).join(' '), styles: {} }),
  useTheme: () => ({ colorFill: '#000', colorText: '#111' }),
}));

vi.mock('antd', () => ({
  Popover: ({ children }: { children: unknown }) => children,
  Tooltip: ({ children }: { children: unknown }) => children,
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@/features/Conversation/components/VirtualizedList/VirtuosoContext', () => ({
  getVirtuosoActiveIndex: () => null,
  getVirtuosoGlobalRef: () => null,
  subscribeVirtuosoActiveIndex: () => () => undefined,
  subscribeVirtuosoGlobalRef: () => () => undefined,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: any) => unknown) => {
    selectors.seen.push(selector);
    return selector({
      activeId: 'session-1',
      activeTopicId: undefined,
      messagesMap: {
        [messageMapKey('session-1')]: [
          { content: 'one', id: '1', role: 'user' },
          { content: 'two', id: '2', role: 'assistant' },
        ],
      },
    });
  },
}));

import ChatMinimap from './index';

describe('ChatMinimap', () => {
  it('subscribes to display IDs and the raw map, not cloned display chats', () => {
    selectors.seen = [];
    render(<ChatMinimap />);

    expect(selectors.seen).toContain(chatSelectors.mainDisplayChatIDs);
    expect(selectors.seen).not.toContain(chatSelectors.mainDisplayChats);
  });
});
