import { registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
  type NodeKey,
  createEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerReplacementTextRangeHandler } from './ReplacementTextPlugin';

// Lexical decides at module-evaluation time whether beforeinput is usable
// (CAN_USE_BEFORE_INPUT checks `'getTargetRanges' in new InputEvent(...)`). happy-dom
// lacks getTargetRanges, which would silently detach lexical's real beforeinput/input
// handlers from every test — the shim must exist before lexical is imported.
vi.hoisted(() => {
  const inputEventConstructor = (globalThis as { InputEvent?: { prototype: object } }).InputEvent;
  const proto = inputEventConstructor?.prototype;

  if (proto && !('getTargetRanges' in proto)) {
    Object.defineProperty(proto, 'getTargetRanges', {
      configurable: true,
      value(this: { __targetRanges?: StaticRange[] }) {
        return this.__targetRanges ?? [];
      },
    });
  }
});

// Lexical defers non-discrete commits (event handlers, command dispatches) to a
// microtask. Browsers run a microtask checkpoint between events; tests must do the
// same before asserting state or dispatching a follow-up event.
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

interface TestEditor {
  editor: LexicalEditor;
  rootElement: HTMLDivElement;
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

  const unregisterRichText = registerRichText(editor);
  const unregisterRangeHandler = registerReplacementTextRangeHandler(editor);
  editor.setRootElement(rootElement);

  const testEditor = {
    editor,
    rootElement,
    unregister: () => {
      unregisterRangeHandler();
      unregisterRichText();
      editor.setRootElement(null);
      rootElement.remove();
    },
  };

  testEditors.push(testEditor);

  return testEditor;
};

afterEach(() => {
  while (testEditors.length > 0) testEditors.pop()?.unregister();
  document.getSelection()?.removeAllRanges();
  localStorage.removeItem('lobe_replacement_debug');
  document.querySelector('#replacement-debug-overlay')?.remove();
});

const getDOMTextNode = (editor: LexicalEditor, key: NodeKey): Text => {
  const element = editor.getElementByKey(key);
  const textNode = element?.firstChild;

  if (!textNode) throw new Error(`Could not find DOM text node for ${key}`);

  return textNode as Text;
};

// happy-dom dispatches selectionchange synchronously from Selection mutations; in real
// browsers it fires as a later task. Re-entering lexical's selectionchange handler in
// the middle of a helper corrupts the flow, so it is muted for the write.
const withMutedSelectionChange = (fn: () => void) => {
  const original = document.dispatchEvent.bind(document);
  const spy = vi.spyOn(document, 'dispatchEvent').mockImplementation((event: Event) => {
    if (event.type === 'selectionchange') return true;

    return original(event);
  });

  try {
    fn();
  } finally {
    spy.mockRestore();
  }
};

const setDOMSelection = (node: Node, anchorOffset: number, focusOffset = anchorOffset) => {
  const selection = document.getSelection();

  if (!selection) return;

  withMutedSelectionChange(() => {
    if (typeof selection.setBaseAndExtent === 'function') {
      selection.setBaseAndExtent(node, anchorOffset, node, focusOffset);
      return;
    }

    const range = document.createRange();
    range.setStart(node, anchorOffset);
    range.setEnd(node, focusOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  });
};

const initText = (
  editor: LexicalEditor,
  text: string,
  anchorOffset: number,
  focusOffset = anchorOffset,
): NodeKey => {
  let key = '';

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(text);
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.select(anchorOffset, focusOffset);
      key = textNode.getKey();
    },
    { discrete: true },
  );
  setDOMSelection(getDOMTextNode(editor, key), anchorOffset, focusOffset);

  return key;
};

const initTwoParagraphs = (
  editor: LexicalEditor,
  firstText: string,
  secondText: string,
  caretOffset: number,
) => {
  const keys = { first: '', second: '' };

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const firstParagraph = $createParagraphNode();
      const firstTextNode = $createTextNode(firstText);
      firstParagraph.append(firstTextNode);
      const secondParagraph = $createParagraphNode();
      const secondTextNode = $createTextNode(secondText);
      secondParagraph.append(secondTextNode);
      root.append(firstParagraph, secondParagraph);
      secondTextNode.select(caretOffset, caretOffset);
      keys.first = firstTextNode.getKey();
      keys.second = secondTextNode.getKey();
    },
    { discrete: true },
  );
  setDOMSelection(getDOMTextNode(editor, keys.second), caretOffset);

  return keys;
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

interface InputEventOptions {
  cancelable?: boolean;
  composing?: boolean;
  data?: string | null;
  html?: string;
  inputType: string;
  plain?: string;
  ranges?: StaticRange[] | 'absent' | 'throw';
  trusted?: boolean;
}

const buildInputEvent = (type: string, options: InputEventOptions) => {
  const event = new InputEvent(type, {
    bubbles: true,
    cancelable: options.cancelable ?? true,
    inputType: options.inputType,
    isComposing: options.composing ?? false,
  });

  // happy-dom defaults `data` to '' and `isTrusted` to false; real events need
  // explicit values (Chromium sends data === null for insertReplacementText).
  Object.defineProperty(event, 'data', { configurable: true, value: options.data ?? null });
  Object.defineProperty(event, 'isTrusted', {
    configurable: true,
    value: options.trusted ?? true,
  });

  if (options.plain !== undefined || options.html !== undefined) {
    const dataTransfer = new DataTransfer();

    if (options.plain !== undefined) dataTransfer.setData('text/plain', options.plain);
    if (options.html !== undefined) dataTransfer.setData('text/html', options.html);

    Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dataTransfer });
  } else {
    Object.defineProperty(event, 'dataTransfer', { configurable: true, value: null });
  }

  if (options.ranges === 'throw') {
    Object.defineProperty(event, 'getTargetRanges', {
      configurable: true,
      value: () => {
        throw new Error('blocked by browser isolation');
      },
    });
  } else if (options.ranges === 'absent') {
    Object.defineProperty(event, 'getTargetRanges', { configurable: true, value: undefined });
  } else if (options.ranges) {
    (event as InputEvent & { __targetRanges?: StaticRange[] }).__targetRanges = options.ranges;
  }

  return event;
};

const dispatchBeforeInput = (target: EventTarget, options: InputEventOptions) => {
  const event = buildInputEvent('beforeinput', options);
  target.dispatchEvent(event);

  return event;
};

const dispatchInput = (target: EventTarget, options: InputEventOptions) => {
  const event = buildInputEvent('input', { ...options, cancelable: false });
  target.dispatchEvent(event);

  return event;
};

const applyNativeEdit = (
  editor: LexicalEditor,
  key: NodeKey,
  newText: string,
  caretOffset = newText.length,
) => {
  const domTextNode = getDOMTextNode(editor, key);
  domTextNode.nodeValue = newText;
  setDOMSelection(domTextNode, caretOffset);
};

const getText = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

const getParagraphCount = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getChildrenSize());

const getParagraphTexts = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getChildren().map((node) => node.getTextContent()));

const getParagraphElement = (editor: LexicalEditor) => {
  const element = editor.getRootElement()?.firstElementChild;

  if (!element) throw new Error('Could not find paragraph element');

  return element as HTMLElement;
};

describe('ReplacementTextPlugin', () => {
  it('runs with lexical beforeinput handling enabled', async () => {
    expect('getTargetRanges' in new InputEvent('input')).toBe(true);

    const { editor } = createTestEditor();
    // Ordering canary: an insertReplacementText without payload must be flagged by the
    // plugin's capture listener before lexical's bubble handler can preventDefault it.
    const key = initText(editor, 'let se', 6);
    const domText = getDOMTextNode(editor, key);
    const event = dispatchBeforeInput(getParagraphElement(editor), {
      inputType: 'insertReplacementText',
      ranges: [createTargetRange(domText, 4, domText, 6)],
    });
    await flush();

    expect(event.defaultPrevented).toBe(false);
    expect(getText(editor)).toBe('let se');
  });

  describe('trusted replacement flow', () => {
    it('replaces the typed prefix through the browser target range', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        html: '<span>see</span>',
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getText(editor)).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('never lets a text/html payload create a paragraph', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        html: '<p>see</p>',
        inputType: 'insertReplacementText',
        plain: 'see\n',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getText(editor)).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('repairs a stale non-collapsed selection from the target range', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 0, 3);
      const domText = getDOMTextNode(editor, key);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getText(editor)).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('rejects a target range crossing paragraphs and replaces the prefix instead', async () => {
      const { editor } = createTestEditor();
      const keys = initTwoParagraphs(editor, 'see', 'se', 2);
      const firstDomText = getDOMTextNode(editor, keys.first);
      const secondDomText = getDOMTextNode(editor, keys.second);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(firstDomText, 0, secondDomText, 2)],
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getParagraphTexts(editor)).toEqual(['see', 'see']);
      expect(getParagraphCount(editor)).toBe(2);
    });

    it('treats a range outside the editor as missing and replaces the prefix', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'let se', 6);
      const outside = document.createElement('div');
      outside.textContent = 'elsewhere';
      document.body.append(outside);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(outside.firstChild as Text, 0, outside.firstChild as Text, 4)],
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getText(editor)).toBe('let see');
      outside.remove();
    });

    it.each([
      ['a collapsed target range', 'insertReplacementText'],
      ['an empty target range list', 'insertReplacementText'],
      ['no getTargetRanges API', 'insertReplacementText'],
      ['a collapsed target range', 'insertText'],
      ['an empty target range list', 'insertText'],
      ['no getTargetRanges API', 'insertText'],
    ])('infers the word prefix with %s (%s)', async (rangeShape, inputType) => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'sorry s', 7);
      const domText = getDOMTextNode(editor, key);
      const ranges =
        rangeShape === 'a collapsed target range'
          ? [createTargetRange(domText, 7, domText, 7)]
          : rangeShape === 'an empty target range list'
            ? []
            : ('absent' as const);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        data: inputType === 'insertText' ? 'sorry' : null,
        inputType,
        plain: inputType === 'insertReplacementText' ? 'sorry' : undefined,
        ranges,
      });
      await flush();

      if (inputType === 'insertReplacementText') {
        expect(event.defaultPrevented).toBe(true);
        expect(getText(editor)).toBe('sorry sorry');
      } else if (event.defaultPrevented) {
        expect(getText(editor)).toBe('sorry sorry');
      } else {
        // Lexical deferred to the browser: simulate the native edit over the repaired
        // selection and let onInput reconcile it.
        applyNativeEdit(editor, key, 'sorry sorry');
        dispatchInput(getParagraphElement(editor), { data: 'sorry', inputType });
        await flush();
        expect(getText(editor)).toBe('sorry sorry');
      }

      expect(getParagraphCount(editor)).toBe(1);
    });
  });

  describe('native fallback', () => {
    it('hands a payload-less replacement to the browser and absorbs the native edit', async () => {
      // Chromium ≤142 sends insertReplacementText with data === null and
      // dataTransfer === null in contenteditable.
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(getText(editor)).toBe('let se');

      applyNativeEdit(editor, key, 'let see');
      dispatchInput(getParagraphElement(editor), { inputType: 'insertReplacementText' });
      await flush();

      expect(getText(editor)).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('applies a synthetic injector replacement itself and suppresses the paired input', async () => {
      // Synthetic events have no native default action: the injector (isolation thin
      // client, overlay extension) expects the editor to perform the replacement, and
      // dispatches a paired input event that must not double-insert through lexical.
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      dispatchBeforeInput(getParagraphElement(editor), {
        cancelable: false,
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 0, domText, 0)],
        trusted: false,
      });
      dispatchInput(getParagraphElement(editor), {
        data: 'see',
        inputType: 'insertReplacementText',
        trusted: false,
      });
      await flush();

      expect(getText(editor)).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('replays the isolation thin-client acceptance sequence without duplication', async () => {
      // Exact shape captured in the field: data=null, text/plain payload with a
      // trailing space, untrusted, non-cancelable, bogus collapsed target range,
      // synchronously followed by a synthetic input carrying the data.
      const { editor } = createTestEditor();
      const key = initText(editor, 'fore', 4);
      const domText = getDOMTextNode(editor, key);

      dispatchBeforeInput(getParagraphElement(editor), {
        cancelable: false,
        data: null,
        inputType: 'insertReplacementText',
        plain: 'forever ',
        ranges: [createTargetRange(domText, 0, domText, 0)],
        trusted: false,
      });
      dispatchInput(getParagraphElement(editor), {
        data: 'forever ',
        inputType: 'insertReplacementText',
        trusted: false,
      });
      await flush();

      expect(getText(editor)).toBe('forever ');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('applies synthetic corrections by replacing the whole typed word', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'let teh', 7);

      dispatchBeforeInput(getParagraphElement(editor), {
        cancelable: false,
        inputType: 'insertReplacementText',
        plain: 'the',
        ranges: [],
        trusted: false,
      });
      dispatchInput(getParagraphElement(editor), {
        data: 'the',
        inputType: 'insertReplacementText',
        trusted: false,
      });
      await flush();

      expect(getText(editor)).toBe('let the');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('hands a non-cancelable replacement to the browser', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        cancelable: false,
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(getText(editor)).toBe('let se');
    });

    it('never fights a composition-delivered replacement', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        composing: true,
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(getText(editor)).toBe('let se');
    });

    it('leaves insertCompositionText alone', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'let se', 6);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        composing: true,
        data: 'see',
        inputType: 'insertCompositionText',
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(getText(editor)).toBe('let se');
    });

    it.each(['insertReplacementText', 'insertText'])(
      'hands the edit to the browser when getTargetRanges throws (%s)',
      async (inputType) => {
        // Lexical calls getTargetRanges without a try/catch; letting such an event
        // reach its handler would crash it mid-flight.
        const { editor } = createTestEditor();
        const key = initText(editor, 'sorry s', 7);

        const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
          data: inputType === 'insertText' ? 'sorry' : null,
          inputType,
          plain: inputType === 'insertReplacementText' ? 'sorry' : undefined,
          ranges: 'throw',
        });
        await flush();

        expect(beforeInput.defaultPrevented).toBe(false);
        expect(getText(editor)).toBe('sorry s');

        applyNativeEdit(editor, key, 'sorry sorry');
        dispatchInput(getParagraphElement(editor), { inputType });
        await flush();

        expect(getText(editor)).toBe('sorry sorry');
        expect(getParagraphCount(editor)).toBe(1);
      },
    );

    it('falls back to the browser for corrections that do not extend the word', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let teh', 7);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'the',
        ranges: [],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(getText(editor)).toBe('let teh');

      applyNativeEdit(editor, key, 'let the');
      dispatchInput(getParagraphElement(editor), { inputType: 'insertReplacementText' });
      await flush();

      expect(getText(editor)).toBe('let the');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('falls back to the browser for multi-word suggestions without a range', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'visit New', 9);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'New York',
        ranges: [],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(false);

      applyNativeEdit(editor, key, 'visit New York');
      dispatchInput(getParagraphElement(editor), { inputType: 'insertReplacementText' });
      await flush();

      expect(getText(editor)).toBe('visit New York');
    });
  });

  describe('preventDefault-ignored guard', () => {
    it('repairs the DOM when the native edit is applied on top of the controlled one', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      const beforeInput = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      expect(beforeInput.defaultPrevented).toBe(true);
      expect(getText(editor)).toBe('let see');

      // A sandboxed browser that ignores preventDefault applies its edit anyway.
      applyNativeEdit(editor, key, 'let seesee', 10);
      dispatchInput(getParagraphElement(editor), { inputType: 'insertReplacementText' });
      await flush();

      expect(getText(editor)).toBe('let see');
      expect(getDOMTextNode(editor, key).nodeValue).toBe('let see');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('does not interfere with an unrelated later input event', async () => {
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      // A second beforeinput disarms the guard before its input event arrives.
      dispatchBeforeInput(getParagraphElement(editor), {
        data: 'x',
        inputType: 'insertText',
      });
      await flush();
      applyNativeEdit(editor, key, 'let seex', 8);
      dispatchInput(getParagraphElement(editor), { data: 'x', inputType: 'insertText' });
      await flush();

      expect(getText(editor)).toBe('let seex');
      expect(getParagraphCount(editor)).toBe(1);
    });
  });

  describe('controlled insertion command', () => {
    it('inserts plain text only and strips newlines for replacement events', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'x', 1);

      const fakeEvent = buildInputEvent('beforeinput', {
        html: '<p>a</p><p>b</p>',
        inputType: 'insertReplacementText',
        plain: 'a\nb\n',
      });
      const handled = editor.dispatchCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        fakeEvent as InputEvent,
      );
      await flush();

      expect(handled).toBe(true);
      expect(getText(editor)).toBe('xa b');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('swallows a replacement event without any usable text', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'x', 1);

      const fakeEvent = buildInputEvent('beforeinput', {
        html: '<p>boom</p>',
        inputType: 'insertReplacementText',
      });
      const handled = editor.dispatchCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        fakeEvent as InputEvent,
      );
      await flush();

      expect(handled).toBe(true);
      expect(getText(editor)).toBe('x');
      expect(getParagraphCount(editor)).toBe(1);
    });

    it('leaves string payloads to the stock rich-text handler', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'x', 1);

      const handled = editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'hi');
      await flush();

      expect(handled).toBe(true);
      expect(getText(editor)).toBe('xhi');
    });
  });

  describe('plumbing', () => {
    it('keeps paragraph insertion untouched', async () => {
      const { editor } = createTestEditor();
      initText(editor, 'let se', 6);

      const event = dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertParagraph',
      });
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(getParagraphCount(editor)).toBe(2);
      expect(getText(editor).replaceAll('\n', '')).toBe('let se');
    });

    it('ignores replacements aimed at nested form controls', async () => {
      const { editor, rootElement } = createTestEditor();
      initText(editor, 'let se', 6);
      const nestedInput = document.createElement('input');
      rootElement.append(nestedInput);

      dispatchBeforeInput(nestedInput, {
        inputType: 'insertReplacementText',
        plain: 'see',
      });
      await flush();

      expect(getText(editor)).toBe('let se');
      nestedInput.remove();
    });

    it('mirrors probe events and decisions into an on-page overlay when enabled', async () => {
      localStorage.setItem('lobe_replacement_debug', '1');
      const { editor } = createTestEditor();
      const key = initText(editor, 'let se', 6);
      const domText = getDOMTextNode(editor, key);

      dispatchBeforeInput(getParagraphElement(editor), {
        inputType: 'insertReplacementText',
        plain: 'see',
        ranges: [createTargetRange(domText, 4, domText, 6)],
      });
      await flush();

      const overlay = document.querySelector('#replacement-debug-overlay');

      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain('beforeinput insertReplacementText');
      expect(overlay?.textContent).toContain('decision: controlled (target-range path');
      expect(getText(editor)).toBe('let see');
    });

    it('arms and disarms debugging via the URL flag', () => {
      location.hash = '#replacement_debug=1';
      createTestEditor();
      expect(localStorage.getItem('lobe_replacement_debug')).toBe('1');

      location.hash = '#replacement_debug=0';
      createTestEditor();
      expect(localStorage.getItem('lobe_replacement_debug')).toBeNull();
      location.hash = '';
    });

    it('moves listeners when the root element changes', () => {
      const { editor, rootElement } = createTestEditor();
      const nextRoot = document.createElement('div');
      nextRoot.contentEditable = 'true';
      document.body.append(nextRoot);

      const removeSpy = vi.spyOn(rootElement, 'removeEventListener');
      const addSpy = vi.spyOn(nextRoot, 'addEventListener');

      editor.setRootElement(nextRoot);

      expect(removeSpy).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);
      expect(removeSpy).toHaveBeenCalledWith('input', expect.any(Function), true);
      expect(addSpy).toHaveBeenCalledWith('beforeinput', expect.any(Function), true);
      expect(addSpy).toHaveBeenCalledWith('input', expect.any(Function), true);

      nextRoot.remove();
    });
  });
});
