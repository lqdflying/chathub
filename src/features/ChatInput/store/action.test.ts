import { describe, expect, it } from 'vitest';

import { IME_PRIMER } from '../InputEditor/imePrimer';
import { createStore } from './index';

const createStoreWithMarkdown = (markdown: string) =>
  createStore({ editor: { getDocument: () => markdown } as any });

describe('ChatInput store getMarkdownContent', () => {
  it('treats a box that holds only the thin-client IME primer as empty', () => {
    expect(createStoreWithMarkdown(`${IME_PRIMER}\n`).getState().getMarkdownContent()).toBe('');
  });

  it('keeps any other content, trimmed at the end', () => {
    expect(createStoreWithMarkdown('你好\n').getState().getMarkdownContent()).toBe('你好');
    expect(createStoreWithMarkdown(`${IME_PRIMER}你好`).getState().getMarkdownContent()).toBe(
      `${IME_PRIMER}你好`,
    );
  });
});
