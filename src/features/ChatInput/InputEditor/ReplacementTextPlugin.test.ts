import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type NodeKey,
  createEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerReplacementTextRangeHandler } from './ReplacementTextPlugin';

interface TestEditor {
  editor: LexicalEditor;
  rootElement: HTMLDivElement;
  stopLexicalBeforeInput: (event: Event) => void;
  unregister: () => void;
}

const testEditors: TestEditor[] = [];

const createTestEditor = (): TestEditor => {
  const editor = createEditor({
    namespace: 'replacement-text-test',
    onError: (error) => {
      throw error;
    },
  });
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.append(rootElement);
  editor.setRootElement(rootElement);

  const unregister = registerReplacementTextRangeHandler(editor);
  const stopLexicalBeforeInput = (event: Event) => event.stopImmediatePropagation();
  rootElement.addEventListener('beforeinput', stopLexicalBeforeInput, true);

  const testEditor = {
    editor,
    rootElement,
    stopLexicalBeforeInput,
    unregister,
  };
  testEditors.push(testEditor);

  return testEditor;
};

const createTargetRange = (
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number,
): StaticRange =>
  ({
    collapsed: startContainer === endContainer && startOffset === endOffset,
    endContainer,
    endOffset,
    startContainer,
    startOffset,
  }) as StaticRange;

const dispatchBeforeInput = (
  target: HTMLElement,
  inputType: string,
  targetRanges: StaticRange[],
) => {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType });
  Object.defineProperty(event, 'getTargetRanges', { value: () => targetRanges });
  target.dispatchEvent(event);
};

const getDOMTextNode = (editor: LexicalEditor, key: NodeKey) => {
  const element = editor.getElementByKey(key);
  const textNode = element?.firstChild;

  if (!textNode) throw new Error(`Could not find DOM text node for ${key}`);

  return textNode;
};

const getTextContent = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

afterEach(() => {
  for (const { editor, rootElement, stopLexicalBeforeInput, unregister } of testEditors.splice(0)) {
    rootElement.removeEventListener('beforeinput', stopLexicalBeforeInput, true);
    unregister();
    editor.setRootElement(null);
    rootElement.remove();
  }
});

describe('registerReplacementTextRangeHandler', () => {
  it('replaces the suggested fragment instead of inserting at a stale caret', () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('let se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(rootElement, 'insertReplacementText', [
      createTargetRange(domTextNode, 4, domTextNode, 6),
    ]);

    editor.update(
      () => {
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if (!$isRangeSelection(selection)) return;

        expect([selection.anchor.offset, selection.focus.offset]).toEqual([4, 6]);
        selection.insertText('see');
      },
      { discrete: true },
    );

    expect(getTextContent(editor)).toBe('let see');
  });

  it('applies replacement ranges that span adjacent formatted text nodes', () => {
    const { editor, rootElement } = createTestEditor();
    let firstTextKey: NodeKey = '';
    let secondTextKey: NodeKey = '';

    editor.update(
      () => {
        const firstTextNode = $createTextNode('let s').toggleFormat('bold');
        const secondTextNode = $createTextNode('e');
        firstTextKey = firstTextNode.getKey();
        secondTextKey = secondTextNode.getKey();
        $getRoot().append($createParagraphNode().append(firstTextNode, secondTextNode));
        secondTextNode.selectEnd();
      },
      { discrete: true },
    );

    dispatchBeforeInput(rootElement, 'insertReplacementText', [
      createTargetRange(
        getDOMTextNode(editor, firstTextKey),
        4,
        getDOMTextNode(editor, secondTextKey),
        1,
      ),
    ]);

    editor.update(
      () => {
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if (!$isRangeSelection(selection)) return;

        expect(selection.anchor.key).toBe(firstTextKey);
        expect(selection.anchor.offset).toBe(4);
        expect(selection.focus.key).toBe(secondTextKey);
        expect(selection.focus.offset).toBe(1);
        selection.insertText('see');
      },
      { discrete: true },
    );

    expect(getTextContent(editor)).toBe('let see');
  });

  it.each([
    ['a different input type', 'insertText', 4, 6],
    ['a collapsed replacement range', 'insertReplacementText', 6, 6],
  ])('ignores %s', (_label, inputType, startOffset, endOffset) => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('let se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(rootElement, inputType, [
      createTargetRange(domTextNode, startOffset, domTextNode, endOffset),
    ]);

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;

      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe(6);
    });
  });

  it('ignores missing and out-of-editor replacement ranges', () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('let se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    dispatchBeforeInput(rootElement, 'insertReplacementText', []);
    const outsideTextNode = document.createTextNode('se');
    dispatchBeforeInput(rootElement, 'insertReplacementText', [
      createTargetRange(outsideTextNode, 0, outsideTextNode, 2),
    ]);

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;

      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.key).toBe(textKey);
      expect(selection.anchor.offset).toBe(6);
    });
  });

  it('ignores replacement events targeted at nested controls', () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('let se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const nestedControl = document.createElement('input');
    rootElement.append(nestedControl);
    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(nestedControl, 'insertReplacementText', [
      createTargetRange(domTextNode, 4, domTextNode, 6),
    ]);

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;

      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe(6);
    });
  });

  it('moves the listener when the editor root changes', () => {
    const editor = createEditor({ disableEvents: true, namespace: 'root-listener-test' });
    const firstRoot = document.createElement('div');
    const secondRoot = document.createElement('div');
    const removeEventListener = vi.spyOn(firstRoot, 'removeEventListener');
    const addEventListener = vi.spyOn(secondRoot, 'addEventListener');
    document.body.append(firstRoot, secondRoot);
    editor.setRootElement(firstRoot);
    const unregister = registerReplacementTextRangeHandler(editor);

    editor.setRootElement(secondRoot);

    expect(removeEventListener).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);

    unregister();
    editor.setRootElement(null);
    firstRoot.remove();
    secondRoot.remove();
  });
});
