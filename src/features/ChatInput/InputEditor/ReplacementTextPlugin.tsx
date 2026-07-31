import { useLexicalEditor } from '@lobehub/editor';
import {
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { memo } from 'react';

export const registerReplacementTextRangeHandler = (editor: LexicalEditor) => {
  let rootElement: HTMLElement | null = null;

  const handleBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent;
    const isTextReplacement =
      inputEvent.inputType === 'insertReplacementText' ||
      (inputEvent.inputType === 'insertText' && inputEvent.data !== null);

    if (
      !isTextReplacement ||
      inputEvent.target !== rootElement ||
      typeof inputEvent.getTargetRanges !== 'function'
    ) {
      return;
    }

    const targetRange = inputEvent.getTargetRanges()[0];

    if (
      !targetRange ||
      targetRange.collapsed ||
      !rootElement.contains(targetRange.startContainer) ||
      !rootElement.contains(targetRange.endContainer)
    ) {
      return;
    }

    let handled = false;

    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || $isRootNode(selection.anchor.getNode())) return;

        selection.applyDOMRange(targetRange);
        handled = true;

        if (!editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, inputEvent)) {
          const transferredText = inputEvent.dataTransfer?.getData('text/plain');
          const replacementText = transferredText || inputEvent.data;

          if (replacementText !== null) selection.insertText(replacementText);
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
