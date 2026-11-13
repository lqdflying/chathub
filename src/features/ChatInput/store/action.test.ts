import {
  CodeblockPlugin,
  CommonPlugin,
  HRPlugin,
  Kernel,
  ListPlugin,
  MarkdownPlugin,
  TablePlugin,
} from '@lobehub/editor';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';

import { IME_PRIMER } from '../InputEditor/imePrimer';
import { createStore } from './index';

// The real editor: the store reads its model, and a mocked serialization would only
// repeat what the test assumes.
const createEditorStore = (markdown = '') => {
  const kernel = new Kernel();
  kernel.registerPlugins([
    CommonPlugin,
    MarkdownPlugin,
    ListPlugin,
    HRPlugin,
    TablePlugin,
    CodeblockPlugin,
  ]);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.append(rootElement);
  kernel.setRootElement(rootElement);
  if (markdown) kernel.setDocument('markdown', markdown);

  return {
    getContent: () =>
      createStore({ editor: kernel as any })
        .getState()
        .getMarkdownContent(),
    update: (change: () => void) => kernel.getLexicalEditor()!.update(change, { discrete: true }),
  };
};

const $createPrimerParagraph = () => $createParagraphNode().append($createTextNode(IME_PRIMER));

const FENCE = '`'.repeat(3);

describe('ChatInput store getMarkdownContent', () => {
  it.each([
    ['plain', () => $getRoot().clear().append($createPrimerParagraph())],
    [
      'bold',
      () =>
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode(IME_PRIMER).toggleFormat('bold'))),
    ],
    [
      'second-paragraph',
      () => $getRoot().clear().append($createParagraphNode(), $createPrimerParagraph()),
    ],
  ])('treats a box that holds only a %s thin-client IME primer as empty', (_, build) => {
    const { getContent, update } = createEditorStore();

    update(build);

    expect(getContent()).toBe('');
  });

  it.each([
    ['a horizontal rule', '---'],
    ['an empty table', '|  |  |\n| --- | --- |\n|  |  |'],
    ['an empty code block', `${FENCE}\n${FENCE}`],
    ['text', '你好'],
  ])('keeps %s that stands next to a primed empty line', (_, markdown) => {
    const { getContent, update } = createEditorStore(markdown);
    const unprimed = getContent();

    expect(unprimed).not.toBe('');

    update(() => $getRoot().append($createPrimerParagraph()));

    expect(getContent().replace(IME_PRIMER, '').trimEnd()).toBe(unprimed);
  });

  it.each([
    ['list item', '- a', '-'],
    ['quote', '> a', '>'],
  ])('counts an empty %s as content with and without the primer', (_, markdown, marker) => {
    // The same answer as in a browser that never gets a primer.
    const { getContent, update } = createEditorStore(markdown);

    update(() => $getRoot().getAllTextNodes()[0].setTextContent(IME_PRIMER));

    expect(getContent()).toBe(`${marker} ${IME_PRIMER}`);

    update(() => $getRoot().getAllTextNodes()[0].remove());

    expect(getContent()).toBe(marker);
  });

  it('keeps text composed into the primer', () => {
    const { getContent, update } = createEditorStore();

    update(() =>
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode(`${IME_PRIMER}你好`))),
    );

    expect(getContent()).toBe(`${IME_PRIMER}你好`);
  });
});
