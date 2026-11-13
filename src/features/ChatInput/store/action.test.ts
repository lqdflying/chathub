import { describe, expect, it } from 'vitest';

import { IME_PRIMER } from '../InputEditor/imePrimer';
import { createStore } from './index';

const createStoreWithDocument = (markdown: string, text: string) =>
  createStore({
    editor: { getDocument: (type: string) => (type === 'text' ? text : markdown) } as any,
  });

describe('ChatInput store getMarkdownContent', () => {
  // Each pair is what the editor serializes for a box that holds only the primer.
  it.each([
    ['plain', `${IME_PRIMER}\n\n`, IME_PRIMER],
    ['bold', `**${IME_PRIMER}**\n\n`, IME_PRIMER],
    ['list item', `- ${IME_PRIMER}\n\n`, IME_PRIMER],
    ['quote', `> ${IME_PRIMER}\n\n`, IME_PRIMER],
    ['second paragraph', `\n\n${IME_PRIMER}\n\n`, `\n\n${IME_PRIMER}`],
  ])('treats a box that holds only a %s thin-client IME primer as empty', (_, markdown, text) => {
    expect(createStoreWithDocument(markdown, text).getState().getMarkdownContent()).toBe('');
  });

  it('keeps any other content, trimmed at the end', () => {
    expect(createStoreWithDocument('你好\n\n', '你好').getState().getMarkdownContent()).toBe(
      '你好',
    );
    expect(
      createStoreWithDocument(`**${IME_PRIMER}你好**\n\n`, `${IME_PRIMER}你好`)
        .getState()
        .getMarkdownContent(),
    ).toBe(`**${IME_PRIMER}你好**`);
  });
});
