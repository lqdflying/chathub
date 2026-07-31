import { useLexicalEditor } from '@lobehub/editor';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { memo } from 'react';

const DEBUG_FLAG = 'lobe_replacement_debug';
const PROBE_EVENTS = [
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

const getReplacementText = (event: InputEvent) => {
  let transferredText: string | null = null;

  try {
    transferredText = event.dataTransfer?.getData('text/plain') ?? null;
  } catch {
    transferredText = null;
  }

  return transferredText || event.data || null;
};

const getWordPrefixLength = (text: string, cursorOffset: number, replacementText: string) => {
  const replacementWord = replacementText.trim();

  if (!replacementWord || /\s/u.test(replacementWord)) return 0;

  const textBeforeCursor = text.slice(0, cursorOffset);
  let currentWord = '';

  if (typeof Intl.Segmenter === 'function') {
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(
      textBeforeCursor,
    )) {
      if (
        segment.isWordLike &&
        segment.index + segment.segment.length === textBeforeCursor.length
      ) {
        currentWord = segment.segment;
      }
    }
  } else {
    currentWord = textBeforeCursor.match(/[\p{L}\p{M}\p{N}_]+$/u)?.[0] || '';
  }

  if (!currentWord) return 0;

  return replacementWord.toLocaleLowerCase().startsWith(currentWord.toLocaleLowerCase())
    ? currentWord.length
    : 0;
};

// Lexical's stopLexicalPropagation flag: its root event wrapper skips any event carrying
// it, which is the supported way to hand an edit back to the browser wholesale.
const setLexicalHandled = (event: Event) => {
  (event as Event & { _lexicalHandled?: boolean })._lexicalHandled = true;
};

const isDebugEnabled = () => {
  try {
    return globalThis.localStorage?.getItem(DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
};

export const registerReplacementTextRangeHandler = (editor: LexicalEditor) => {
  let rootElement: HTMLElement | null = null;
  let pendingTrusted: { event: InputEvent; timeStamp: number } | null = null;

  const isEditorTarget = (target: EventTarget | null): boolean => {
    if (!rootElement || !(target instanceof Node)) return false;
    if (target === rootElement) return true;
    if (!rootElement.contains(target)) return false;

    return !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    );
  };

  const resolveTargetRange = (
    event: InputEvent,
  ): { blocked: boolean; range: StaticRange | null } => {
    if (!rootElement) return { blocked: false, range: null };

    let range: StaticRange | undefined;

    try {
      range = event.getTargetRanges?.()[0];
    } catch {
      // Some isolated browsers expose getTargetRanges but throw on calling it. Lexical
      // invokes it without a try/catch, so such events must never reach its handler.
      return { blocked: true, range: null };
    }

    if (!range || range.collapsed) return { blocked: false, range: null };

    const { startContainer, endContainer } = range;

    if (!rootElement.contains(startContainer) || !rootElement.contains(endContainer))
      return { blocked: false, range: null };

    // Windows can hand over ranges that cross block boundaries or point at DOM lexical
    // does not own; replacing across blocks would merge paragraphs.
    const withinOneBlock = editor.read(() => {
      const startNode = $getNearestNodeFromDOMNode(startContainer);
      const endNode = $getNearestNodeFromDOMNode(endContainer);

      if (!startNode || !endNode) return false;

      const startTop = startNode.getTopLevelElement();
      const endTop = endNode.getTopLevelElement();

      return startTop !== null && endTop !== null && startTop.is(endTop);
    });

    return { blocked: false, range: withinOneBlock ? range : null };
  };

  const getInferredPrefixLength = (replacementText: string) =>
    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return 0;
      if (selection.anchor.type !== 'text') return 0;

      const anchorNode = selection.anchor.getNode();

      if (!$isTextNode(anchorNode)) return 0;

      return getWordPrefixLength(
        anchorNode.getTextContent(),
        selection.anchor.offset,
        replacementText,
      );
    });

  const applyRangeIfSelectionStale = (range: StaticRange) => {
    // Lexical only applies the browser's target range when its own selection is
    // collapsed; a stale non-collapsed selection would misroute the replacement.
    const stale = editor.read(() => {
      const selection = $getSelection();

      return $isRangeSelection(selection) && !selection.isCollapsed();
    });

    if (!stale) return;

    editor.update(
      () => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) selection.applyDOMRange(range);
      },
      { discrete: true },
    );
  };

  const selectTypedPrefix = (prefixLength: number) => {
    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        if (selection.anchor.type !== 'text') return;

        const anchorNode = selection.anchor.getNode();

        if (!$isTextNode(anchorNode) || selection.anchor.offset < prefixLength) return;

        selection.setTextNodeRange(
          anchorNode,
          selection.anchor.offset - prefixLength,
          anchorNode,
          selection.anchor.offset,
        );
      },
      { discrete: true },
    );
  };

  const handleBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent;

    pendingTrusted = null;

    if (!isEditorTarget(inputEvent.target)) return;

    const { inputType } = inputEvent;
    const isReplacement = inputType === 'insertReplacementText';
    const isExpandedInsert =
      inputType === 'insertText' &&
      (inputEvent.dataTransfer !== null || (inputEvent.data ?? '').length > 1);

    if (!isReplacement && !isExpandedInsert) return;

    const composing = inputEvent.isComposing || editor.isComposing();
    const replacementText = getReplacementText(inputEvent);
    const { blocked, range: targetRange } = resolveTargetRange(inputEvent);
    const prefixLength =
      !targetRange && replacementText ? getInferredPrefixLength(replacementText) : 0;

    if (blocked) {
      setLexicalHandled(inputEvent);
      return;
    }

    if (isReplacement) {
      // When the edit cannot be safely re-done by lexical (mid-composition, synthetic
      // or non-cancelable events, or no payload/range to work from — e.g. Chromium
      // ≤142 sends insertReplacementText with neither data nor dataTransfer), hand it
      // back to the browser entirely: the native edit lands once and lexical's input
      // reconciliation syncs the DOM into the model. Fighting these events is how the
      // suggestion ends up applied twice.
      const nativeFallback =
        composing ||
        !inputEvent.isTrusted ||
        !inputEvent.cancelable ||
        !replacementText ||
        (!targetRange && prefixLength === 0);

      if (nativeFallback) {
        setLexicalHandled(inputEvent);
        return;
      }
    } else if (composing) {
      return;
    }

    // Only repair the selection; lexical's own beforeinput handler performs the
    // preventDefault and the controlled insertion.
    if (targetRange) {
      applyRangeIfSelectionStale(targetRange);
    } else if (prefixLength > 0) {
      selectTypedPrefix(prefixLength);
    } else {
      return;
    }

    pendingTrusted = { event: inputEvent, timeStamp: inputEvent.timeStamp };
  };

  const handleInput = (event: Event) => {
    const armed = pendingTrusted;

    pendingTrusted = null;

    if (!armed) return;

    const inputEvent = event as InputEvent;

    if (!isEditorTarget(inputEvent.target)) return;
    // A prevented beforeinput produces no input event in compliant browsers, so this
    // only triggers where the environment applied the native edit anyway.
    if (!armed.event.defaultPrevented) return;
    if (inputEvent.timeStamp - armed.timeStamp > 100) return;

    const staleNodeKey = editor.getEditorState().read(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection)) return null;

      const anchorNode = selection.anchor.getNode();

      if (!$isTextNode(anchorNode)) return null;

      const dom = editor.getElementByKey(anchorNode.getKey());

      return dom && dom.textContent !== anchorNode.getTextContent()
        ? anchorNode.getKey()
        : null;
    });

    if (staleNodeKey === null) return;

    // The model already holds the controlled insertion; stop lexical's input handler
    // from copying the doubled DOM text back in, and rewrite the DOM from the model
    // (marking the node dirty makes the reconciler diff against the live DOM value).
    setLexicalHandled(inputEvent);
    editor.update(
      () => {
        const node = $getNodeByKey(staleNodeKey);

        if ($isTextNode(node)) node.markDirty();

        const selection = $getSelection();

        if ($isRangeSelection(selection)) selection.dirty = true;
      },
      { discrete: true },
    );
  };

  const handleProbe = (event: Event) => {
    try {
      const inputEvent = event as InputEvent;
      let targetRanges: unknown;

      try {
        targetRanges = inputEvent.getTargetRanges?.().map((range) => ({
          collapsed: range.collapsed,
          end: `${range.endContainer.nodeName}:${range.endOffset}`,
          start: `${range.startContainer.nodeName}:${range.startOffset}`,
        }));
      } catch (error) {
        targetRanges = `error: ${String(error)}`;
      }

      // eslint-disable-next-line no-console
      console.debug('[ReplacementTextPlugin]', event.type, {
        cancelable: event.cancelable,
        data: inputEvent.data,
        dataTransferTypes: inputEvent.dataTransfer ? [...inputEvent.dataTransfer.types] : null,
        editorComposing: editor.isComposing(),
        inputType: inputEvent.inputType,
        isComposing: inputEvent.isComposing,
        isTrusted: event.isTrusted,
        targetRanges,
      });
    } catch {
      // Diagnostics must never break input handling.
    }
  };

  const unregisterCommand = editor.registerCommand(
    CONTROLLED_TEXT_INSERTION_COMMAND,
    (payload) => {
      if (typeof payload === 'string') return false;
      if (!payload || payload.inputType !== 'insertReplacementText') return false;
      // A replacement aimed at a nested control must not be inserted into the editor.
      if (payload.target && !isEditorTarget(payload.target)) return true;

      const selection = $getSelection();

      if (!$isRangeSelection(selection)) return false;

      const raw = getReplacementText(payload) ?? '';
      // A suggestion replaces a word inline: trailing newlines from Enter-acceptance
      // and rich text/html payloads must never create paragraphs (the rich-text
      // handler's dataTransfer path would) nor re-trigger send-on-enter.
      const text = raw.replace(/(?:\r?\n)+$/u, '').replaceAll(/\r?\n/gu, ' ');

      if (text) selection.insertText(text);

      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );

  const unregisterRootListener = editor.registerRootListener(
    (nextRootElement, previousRootElement) => {
      pendingTrusted = null;

      if (previousRootElement) {
        previousRootElement.removeEventListener('beforeinput', handleBeforeInput, true);
        previousRootElement.removeEventListener('input', handleInput, true);
        for (const type of PROBE_EVENTS)
          previousRootElement.removeEventListener(type, handleProbe, true);
      }

      if (nextRootElement) {
        nextRootElement.addEventListener('beforeinput', handleBeforeInput, true);
        nextRootElement.addEventListener('input', handleInput, true);

        if (isDebugEnabled())
          for (const type of PROBE_EVENTS) nextRootElement.addEventListener(type, handleProbe, true);
      }

      rootElement = nextRootElement;
    },
  );

  return () => {
    unregisterRootListener();
    unregisterCommand();
  };
};

const ReplacementTextPlugin = memo(() => {
  useLexicalEditor(registerReplacementTextRangeHandler, []);

  return null;
});

ReplacementTextPlugin.displayName = 'ReplacementTextPlugin';

export default ReplacementTextPlugin;
