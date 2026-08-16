import { act, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
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

describe('DallE render', () => {
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
