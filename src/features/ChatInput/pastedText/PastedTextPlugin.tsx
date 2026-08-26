'use client';

import { useLexicalEditor } from '@lobehub/editor';
import { LexicalEditor } from 'lexical';
import { memo } from 'react';

import { captureLargePlainPaste } from './capture';

const registerPastedTextPasteHandler = (editor: LexicalEditor) => {
  let handler: ((event: ClipboardEvent) => void) | undefined;

  return editor.registerRootListener((nextRootElement, previousRootElement) => {
    if (previousRootElement && handler) {
      previousRootElement.removeEventListener('paste', handler, true);
    }

    if (nextRootElement) {
      handler = (event) => {
        captureLargePlainPaste(event);
      };
      nextRootElement.addEventListener('paste', handler, true);
    }
  });
};

const PastedTextPlugin = memo(() => {
  useLexicalEditor(registerPastedTextPasteHandler, []);

  return null;
});

PastedTextPlugin.displayName = 'PastedTextPlugin';

export default PastedTextPlugin;
