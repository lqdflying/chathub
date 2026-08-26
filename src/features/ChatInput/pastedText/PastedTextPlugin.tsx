'use client';

import { useLexicalEditor } from '@lobehub/editor';
import { LexicalEditor } from 'lexical';
import { memo, useRef } from 'react';

import { createShiftPasteBypassTracker } from './bypass';
import { captureLargePlainPaste } from './capture';
import { usePastedTextScope } from './PastedTextScopeContext';

const registerPastedTextPasteHandler = (editor: LexicalEditor, getScope: () => string) => {
  const tracker = createShiftPasteBypassTracker();
  let blurHandler: (() => void) | undefined;
  let keyDownHandler: ((event: KeyboardEvent) => void) | undefined;
  let keyUpHandler: ((event: KeyboardEvent) => void) | undefined;
  let pasteHandler: ((event: ClipboardEvent) => void) | undefined;

  return editor.registerRootListener((nextRootElement, previousRootElement) => {
    if (previousRootElement) {
      if (blurHandler) previousRootElement.removeEventListener('blur', blurHandler);
      if (keyDownHandler) previousRootElement.removeEventListener('keydown', keyDownHandler, true);
      if (keyUpHandler) previousRootElement.removeEventListener('keyup', keyUpHandler, true);
      if (pasteHandler) previousRootElement.removeEventListener('paste', pasteHandler, true);
    }

    if (nextRootElement) {
      blurHandler = () => {
        tracker.reset();
      };
      keyDownHandler = (event) => {
        tracker.onKeyDown(event);
      };
      keyUpHandler = (event) => {
        tracker.onKeyUp(event);
      };
      pasteHandler = (event) => {
        captureLargePlainPaste(event, {
          bypass: tracker.consumeBypass(),
          scope: getScope(),
        });
      };
      nextRootElement.addEventListener('blur', blurHandler);
      nextRootElement.addEventListener('keydown', keyDownHandler, true);
      nextRootElement.addEventListener('keyup', keyUpHandler, true);
      nextRootElement.addEventListener('paste', pasteHandler, true);
    }
  });
};

const PastedTextPlugin = memo(() => {
  const scope = usePastedTextScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useLexicalEditor((editor) => registerPastedTextPasteHandler(editor, () => scopeRef.current), []);

  return null;
});

PastedTextPlugin.displayName = 'PastedTextPlugin';

export default PastedTextPlugin;
