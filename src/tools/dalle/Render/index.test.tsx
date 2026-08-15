import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

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
});
