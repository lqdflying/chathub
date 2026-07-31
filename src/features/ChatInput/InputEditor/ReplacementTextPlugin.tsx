import { useLexicalEditor } from '@lobehub/editor';
import { $getSelection, $isRangeSelection, $isRootNode, type LexicalEditor } from 'lexical';
import { memo } from 'react';

export const registerReplacementTextRangeHandler = (editor: LexicalEditor) => {
  let rootElement: HTMLElement | null = null;

  const handleBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent;

    if (
      inputEvent.inputType !== 'insertReplacementText' ||
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

    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || $isRootNode(selection.anchor.getNode())) return;

        selection.applyDOMRange(targetRange);
      },
      { discrete: true },
    );
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
