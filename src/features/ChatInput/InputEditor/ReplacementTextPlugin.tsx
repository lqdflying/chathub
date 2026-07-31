import { useLexicalEditor } from '@lobehub/editor';
import {
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { memo } from 'react';

const getReplacementText = (event: InputEvent) => {
  const transferredText = event.dataTransfer?.getData('text/plain');

  return transferredText || event.data;
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

export const registerReplacementTextRangeHandler = (editor: LexicalEditor) => {
  let rootElement: HTMLElement | null = null;

  const handleBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent;
    const isTextReplacement =
      inputEvent.inputType === 'insertReplacementText' ||
      (inputEvent.inputType === 'insertText' &&
        (inputEvent.data !== null || inputEvent.dataTransfer !== null));

    if (!isTextReplacement || inputEvent.target !== rootElement) {
      return;
    }

    let targetRange: StaticRange | undefined;

    try {
      targetRange = inputEvent.getTargetRanges?.()[0];
    } catch {
      // Some isolated browsers expose getTargetRanges but block access to it.
    }

    if (
      targetRange &&
      (!rootElement.contains(targetRange.startContainer) ||
        !rootElement.contains(targetRange.endContainer))
    ) {
      return;
    }

    const replacementText = getReplacementText(inputEvent);

    if (replacementText === null) return;

    const hasAuthoritativeRange = !!targetRange && !targetRange.collapsed;
    const canInferPrefixRange =
      !hasAuthoritativeRange &&
      !inputEvent.isComposing &&
      (inputEvent.inputType === 'insertReplacementText' || replacementText.trim().length > 1);

    if (!hasAuthoritativeRange && !canInferPrefixRange) return;

    let handled = false;

    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || $isRootNode(selection.anchor.getNode())) return;

        if (targetRange) selection.applyDOMRange(targetRange);

        if (!hasAuthoritativeRange) {
          if (!selection.isCollapsed() || selection.anchor.type !== 'text') return;

          const anchorNode = selection.anchor.getNode();

          if (!$isTextNode(anchorNode)) return;

          const prefixLength = getWordPrefixLength(
            anchorNode.getTextContent(),
            selection.anchor.offset,
            replacementText,
          );

          if (prefixLength === 0) return;

          selection.setTextNodeRange(
            anchorNode,
            selection.anchor.offset - prefixLength,
            anchorNode,
            selection.anchor.offset,
          );
        }

        handled = true;

        if (!editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent)) {
          selection.insertText(replacementText);
        }
      },
      { discrete: true },
    );

    if (handled) {
      inputEvent.preventDefault();
      inputEvent.stopImmediatePropagation();
    }
  };

  return editor.registerRootListener((nextRootElement, previousRootElement) => {
    previousRootElement?.removeEventListener('beforeinput', handleBeforeInput, true);
    nextRootElement?.addEventListener('beforeinput', handleBeforeInput, true);
    rootElement = nextRootElement;
  });
};

const ReplacementTextPlugin = memo(() => {
  useLexicalEditor(registerReplacementTextRangeHandler, []);

  return null;
});

ReplacementTextPlugin.displayName = 'ReplacementTextPlugin';

export default ReplacementTextPlugin;
