import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
  type NodeKey,
  createEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerReplacementTextRangeHandler } from './ReplacementTextPlugin';

interface TestEditor {
  editor: LexicalEditor;
  rootElement: HTMLDivElement;
  stopLexicalBeforeInput: ReturnType<typeof vi.fn<(event: Event) => void>>;
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

  const unregisterControlledInsertion = editor.registerCommand(
    CONTROLLED_TEXT_INSERTION_COMMAND,
    (eventOrText) => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection)) return false;

      const text =
        typeof eventOrText === 'string'
          ? eventOrText
          : eventOrText.dataTransfer?.getData('text/plain') || eventOrText.data;

      if (text !== null) selection.insertText(text);

      return true;
    },
    COMMAND_PRIORITY_EDITOR,
  );
  const unregisterRangeHandler = registerReplacementTextRangeHandler(editor);
  const stopLexicalBeforeInput = vi.fn((event: Event) => event.stopImmediatePropagation());
  rootElement.addEventListener('beforeinput', stopLexicalBeforeInput, true);

  const testEditor = {
    editor,
    rootElement,
    stopLexicalBeforeInput,
    unregister: () => {
      unregisterRangeHandler();
      unregisterControlledInsertion();
    },
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
  targetRanges: StaticRange[] | 'throw' | undefined,
  replacementText: string,
  isComposing = false,
) => {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data: inputType === 'insertText' ? replacementText : null,
    inputType,
    isComposing,
  });

  if (inputType === 'insertReplacementText') {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', replacementText);
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  }

  if (targetRanges === 'throw') {
    Object.defineProperty(event, 'getTargetRanges', {
      value: () => {
        throw new Error('blocked by browser isolation');
      },
    });
  } else if (targetRanges) {
    Object.defineProperty(event, 'getTargetRanges', { value: () => targetRanges });
  }

  target.dispatchEvent(event);

  return event;
};

const dispatchInput = (target: HTMLElement, inputType = 'insertText') => {
  const event = new InputEvent('input', { bubbles: true, inputType });
  target.dispatchEvent(event);

  return event;
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
    const { editor, rootElement, stopLexicalBeforeInput } = createTestEditor();
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
    const event = dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [createTargetRange(domTextNode, 4, domTextNode, 6)],
      'see',
    );

    expect(event.defaultPrevented).toBe(true);
    expect(stopLexicalBeforeInput).not.toHaveBeenCalled();
    expect(getTextContent(editor)).toBe('let see');
  });

  it('applies replacement ranges that span adjacent formatted text nodes', () => {
    const { editor, rootElement, stopLexicalBeforeInput } = createTestEditor();
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

    const event = dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [
        createTargetRange(
          getDOMTextNode(editor, firstTextKey),
          4,
          getDOMTextNode(editor, secondTextKey),
          1,
        ),
      ],
      'see',
    );

    expect(event.defaultPrevented).toBe(true);
    expect(stopLexicalBeforeInput).not.toHaveBeenCalled();
    expect(getTextContent(editor)).toBe('let see');
  });

  it.each([
    ['a collapsed caret', 14, 14],
    ['a stale non-collapsed selection', 0, 9],
  ])('handles insertText replacement ranges with %s', (_label, anchorOffset, focusOffset) => {
    const { editor, rootElement, stopLexicalBeforeInput } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('something some');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.select(anchorOffset, focusOffset);
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    const event = dispatchBeforeInput(
      rootElement,
      'insertText',
      [createTargetRange(domTextNode, 10, domTextNode, 14)],
      'something',
    );

    expect(event.defaultPrevented).toBe(true);
    expect(stopLexicalBeforeInput).not.toHaveBeenCalled();
    expect(getTextContent(editor)).toBe('something something');
  });

  it.each([
    ['a collapsed insertReplacementText range', 'insertReplacementText', 'collapsed'],
    ['a collapsed insertText range', 'insertText', 'collapsed'],
    ['an empty target range list', 'insertReplacementText', 'empty'],
    ['no getTargetRanges API', 'insertReplacementText', 'unavailable'],
    ['a blocked getTargetRanges API', 'insertReplacementText', 'throw'],
  ])('infers the current word prefix with %s', (_label, inputType, rangeType) => {
    const { editor, rootElement, stopLexicalBeforeInput } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('sorry s');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    const targetRanges =
      rangeType === 'collapsed'
        ? [createTargetRange(domTextNode, 7, domTextNode, 7)]
        : rangeType === 'empty'
          ? []
          : rangeType === 'throw'
            ? 'throw'
            : undefined;
    const event = dispatchBeforeInput(rootElement, inputType, targetRanges, 'sorry');

    expect(event.defaultPrevented).toBe(true);
    expect(stopLexicalBeforeInput).not.toHaveBeenCalled();
    expect(getTextContent(editor)).toBe('sorry sorry');
  });

  it('restores the handled state when an isolated browser replays a suggestion', async () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';
    let replayedText = '';

    editor.update(
      () => {
        const textNode = $createTextNode('for fore one');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.select(8, 8);
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [createTargetRange(domTextNode, 8, domTextNode, 8)],
      'forever',
    );

    expect(getTextContent(editor)).toBe('for forever one');

    const replayNativeInsertion = () => {
      editor.update(
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.insertText('forever');
        },
        { onUpdate: () => (replayedText = getTextContent(editor)) },
      );
    };
    rootElement.addEventListener('input', replayNativeInsertion);

    dispatchInput(rootElement);
    rootElement.removeEventListener('input', replayNativeInsertion);
    await Promise.resolve();

    expect(replayedText).toBe('for foreverforever one');
    expect(getTextContent(editor)).toBe('for forever one');
  });

  it('restores the handled state when a replay creates another paragraph', async () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';
    let replayedParagraphCount = 0;

    editor.update(
      () => {
        const textNode = $createTextNode('se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [createTargetRange(domTextNode, 2, domTextNode, 2)],
      'see',
    );

    const replayNativeInsertion = () => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append(
            $createParagraphNode().append($createTextNode('see')),
            $createParagraphNode().append($createTextNode('see')),
          );
        },
        {
          onUpdate: () =>
            editor.getEditorState().read(() => {
              replayedParagraphCount = $getRoot().getChildrenSize();
            }),
        },
      );
    };
    rootElement.addEventListener('input', replayNativeInsertion);

    dispatchInput(rootElement, 'insertParagraph');
    rootElement.removeEventListener('input', replayNativeInsertion);
    await Promise.resolve();

    expect(replayedParagraphCount).toBe(2);
    expect(getTextContent(editor)).toBe('see');
    editor.getEditorState().read(() => expect($getRoot().getChildrenSize()).toBe(1));
  });

  it('does not restore a suggestion over subsequent user input', async () => {
    const { editor, rootElement } = createTestEditor();
    let textKey: NodeKey = '';

    editor.update(
      () => {
        const textNode = $createTextNode('se');
        textKey = textNode.getKey();
        $getRoot().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true },
    );

    const domTextNode = getDOMTextNode(editor, textKey);
    dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [createTargetRange(domTextNode, 2, domTextNode, 2)],
      'see',
    );
    dispatchBeforeInput(rootElement, 'insertText', undefined, 'x');
    editor.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText('x');
      },
      { discrete: true },
    );

    dispatchInput(rootElement);
    await Promise.resolve();

    expect(getTextContent(editor)).toBe('seex');
  });

  it.each([
    ['a different input type', 'insertTranspose', 'see', false],
    ['a single-character insertText event', 'insertText', 'e', false],
    ['a composing insertText event', 'insertText', 'see', true],
    ['an insertText event without a matching prefix', 'insertText', 'other', false],
  ])('ignores %s', (_label, inputType, replacementText, isComposing) => {
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
    dispatchBeforeInput(
      rootElement,
      inputType,
      [createTargetRange(domTextNode, 6, domTextNode, 6)],
      replacementText,
      isComposing,
    );

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;

      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe(6);
    });
  });

  it('ignores out-of-editor replacement ranges', () => {
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

    const outsideTextNode = document.createTextNode('se');
    dispatchBeforeInput(
      rootElement,
      'insertReplacementText',
      [createTargetRange(outsideTextNode, 0, outsideTextNode, 2)],
      'see',
    );

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
    dispatchBeforeInput(
      nestedControl,
      'insertReplacementText',
      [createTargetRange(domTextNode, 4, domTextNode, 6)],
      'see',
    );

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
    expect(removeEventListener).toHaveBeenCalledWith('input', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith('input', expect.any(Function), true);

    unregister();
    editor.setRootElement(null);
    firstRoot.remove();
    secondRoot.remove();
  });
});
