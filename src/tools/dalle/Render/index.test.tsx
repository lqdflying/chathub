import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useImageStore } from '@/store/image';

import DallE from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  PreviewGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const seenItems: unknown[][] = [];
vi.mock('./GalleyGrid', () => ({
  default: ({ items }: { items: unknown[] }) => {
    seenItems.push(items);
    return <div data-testid="grid" />;
  },
}));

vi.mock('./Item', () => ({ default: () => null }));

const inboxKey = messageMapKey('inbox', undefined);

describe('DallE render', () => {
  let previousReconcile = useChatStore.getState().reconcileDallETasks;

  beforeEach(() => {
    previousReconcile = useChatStore.getState().reconcileDallETasks;
    useChatStore.setState({ reconcileDallETasks: vi.fn() });
  });

  afterEach(() => {
    seenItems.length = 0;
    useChatStore.setState({
      messagesMap: {},
      reconcileDallETasks: previousReconcile,
    });
  });

  it.each([
    ['raw arguments object', { prompts: ['a cat'] } as any],
    ['undefined content', undefined as any],
    ['string content', 'streaming…' as any],
  ])('does not throw when content is a %s (chat-crash regression)', (_label, content) => {
    // while the tool call streams/transforms, content is not yet the item
    // array — a bare .map here previously took down the whole chat page
    expect(() => render(<DallE content={content} messageId="m1" />)).not.toThrow();
    expect(seenItems.at(-1)).toEqual([]);
  });

  it('renders the item array with messageId attached', () => {
    render(<DallE content={[{ prompt: 'a cat' }] as any} messageId="m2" />);
    expect(seenItems.at(-1)).toEqual([{ messageId: 'm2', prompt: 'a cat' }]);
  });

  it('prefers live store imageId over stale prompt-only props', () => {
    useChatStore.setState({
      activeId: 'inbox',
      activeTopicId: undefined,
      messagesMap: {
        [inboxKey]: [
          {
            content: JSON.stringify([{ imageId: 'file-live', prompt: 'a cat' }]),
            id: 'm-live',
            meta: {},
            role: 'tool',
          } as never,
        ],
      },
    });

    render(<DallE content={[{ prompt: 'a cat' }] as any} messageId="m-live" />);
    expect(seenItems.at(-1)).toEqual([
      { imageId: 'file-live', messageId: 'm-live', prompt: 'a cat' },
    ]);
  });

  it('fills imageId from message imageList when content is prompt-only', () => {
    useChatStore.setState({
      activeId: 'inbox',
      activeTopicId: undefined,
      messagesMap: {
        [inboxKey]: [
          {
            content: JSON.stringify([{ prompt: 'a cat' }]),
            id: 'm-linked',
            imageList: [{ alt: 'a cat', id: 'file-linked', url: '' }],
            meta: {},
            role: 'tool',
          } as never,
        ],
      },
    });

    render(<DallE content={[{ prompt: 'a cat' }] as any} messageId="m-linked" />);
    expect(seenItems.at(-1)).toMatchObject([
      { imageId: 'file-linked', messageId: 'm-linked', prompt: 'a cat' },
    ]);
  });

  it('re-runs reconciliation when the image config finishes hydrating (R16-2)', () => {
    const reconcileSpy = vi.fn();
    const previous = useChatStore.getState().reconcileDallETasks;
    useChatStore.setState({ reconcileDallETasks: reconcileSpy });
    const previousInit = useImageStore.getState().isInit;
    useImageStore.setState({ isInit: false });

    try {
      render(<DallE content={[{ prompt: 'a cat' }] as any} messageId="m3" />);
      expect(reconcileSpy).toHaveBeenCalledTimes(1);

      // hydration settles LATER (possibly after reconcile's bounded wait
      // expired) — the subscription must fire a fresh reconcile without a
      // remount or manual Retry
      act(() => {
        useImageStore.setState({ isInit: true });
      });
      expect(reconcileSpy).toHaveBeenCalledTimes(2);
      expect(reconcileSpy).toHaveBeenLastCalledWith('m3');
    } finally {
      useChatStore.setState({ reconcileDallETasks: previous });
      useImageStore.setState({ isInit: previousInit });
    }
  });
});
