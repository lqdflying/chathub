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
const DEBUG_OVERLAY_ID = 'replacement-debug-overlay';
const PROBE_EVENTS = [
  'beforeinput',
  'input',
  'textInput',
  'keydown',
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

const getCurrentWord = (textBeforeCursor: string) => {
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

  return currentWord;
};

const getWordReplaceLength = (
  text: string,
  cursorOffset: number,
  replacementText: string,
  // Corrections ("teh" → "the") replace the whole typed word rather than extending a
  // prefix. Only the synthetic-injector path opts in: there is no native edit to fall
  // back on, so dropping the suggestion would lose it entirely.
  allowWholeWord: boolean,
) => {
  const replacementWord = replacementText.trim();

  if (!replacementWord || /\s/u.test(replacementWord)) return 0;

  const currentWord = getCurrentWord(text.slice(0, cursorOffset));

  if (!currentWord) return 0;

  if (replacementWord.toLocaleLowerCase().startsWith(currentWord.toLocaleLowerCase()))
    return currentWord.length;

  return allowWholeWord ? currentWord.length : 0;
};

// Lexical's stopLexicalPropagation flag: its root event wrapper skips any event carrying
// it, which is the supported way to hand an edit back to the browser wholesale.
const setLexicalHandled = (event: Event) => {
  (event as Event & { _lexicalHandled?: boolean })._lexicalHandled = true;
};

const isDebugEnabled = () => {
  try {
    // The URL is the only inbound channel that survives remote-browser-isolation
    // products (DevTools and localStorage commands run in the local thin client, not
    // in the remote browser executing this code). Seeing the flag once persists it.
    const href = globalThis.location?.href ?? '';

    if (/[#&?]replacement_debug=1/.test(href)) globalThis.localStorage?.setItem(DEBUG_FLAG, '1');
    else if (/[#&?]replacement_debug=0/.test(href))
      globalThis.localStorage?.removeItem(DEBUG_FLAG);

    return globalThis.localStorage?.getItem(DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
};

// Debug output is mirrored into an on-page overlay because a mirrored DOM is the only
// outbound channel isolated browsers stream back to the user; console.debug is kept
// for regular browsers.
let overlayElement: HTMLElement | null = null;

const debugPrint = (line: string) => {
  try {
    // eslint-disable-next-line no-console
    console.debug('[ReplacementTextPlugin]', line);

    const doc = globalThis.document;

    if (!doc?.body) return;

    if (!overlayElement || !overlayElement.isConnected) {
      overlayElement = doc.createElement('div');
      overlayElement.id = DEBUG_OVERLAY_ID;
      overlayElement.style.cssText =
        'position:fixed;bottom:8px;right:8px;z-index:2147483647;max-width:46vw;' +
        'max-height:42vh;overflow:auto;background:rgba(0,0,0,0.82);color:#7CFC00;' +
        'font:11px/1.5 monospace;padding:8px;border-radius:6px;pointer-events:none;' +
        'white-space:pre-wrap;word-break:break-all;';
      const header = doc.createElement('div');
      header.textContent = 'replacement debug on (disable: ?replacement_debug=0)';
      overlayElement.append(header);
      doc.body.append(overlayElement);
    }

    const entry = doc.createElement('div');
    entry.textContent = line;
    overlayElement.append(entry);

    while (overlayElement.childElementCount > 40) overlayElement.children[1]?.remove();

    overlayElement.scrollTop = overlayElement.scrollHeight;
  } catch {
    // Diagnostics must never break input handling.
  }
};

const describeEvent = (event: Event, editor: LexicalEditor) => {
  const inputEvent = event as InputEvent;
  let ranges = '';

  try {
    ranges =
      inputEvent.getTargetRanges?.()
        .map(
          (range) =>
            `${range.startContainer.nodeName}:${range.startOffset}-${range.endContainer.nodeName}:${range.endOffset}${range.collapsed ? '(collapsed)' : ''}`,
        )
        .join(',') ?? 'no-api';
  } catch {
    ranges = 'THROWS';
  }

  let plain: string | null = null;

  try {
    plain = inputEvent.dataTransfer?.getData('text/plain') ?? null;
  } catch {
    plain = 'THROWS';
  }

  const key = (event as KeyboardEvent).key;

  return (
    `${event.type} ${inputEvent.inputType ?? key ?? ''} ` +
    `data=${JSON.stringify(inputEvent.data ?? null)} ` +
    `plain=${JSON.stringify(plain)} ` +
    `dt=[${inputEvent.dataTransfer ? [...inputEvent.dataTransfer.types].join(',') : 'null'}] ` +
    `trust=${event.isTrusted ? 1 : 0} cancel=${event.cancelable ? 1 : 0} ` +
    `comp=${inputEvent.isComposing ? 1 : 0} edComp=${editor.isComposing() ? 1 : 0} ` +
    `ranges=[${ranges}]`
  );
};

export const registerReplacementTextRangeHandler = (editor: LexicalEditor) => {
  let rootElement: HTMLElement | null = null;
  let pendingTrusted: { event: InputEvent; timeStamp: number } | null = null;
  let debugEnabled = false;

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

  const getInferredReplaceLength = (replacementText: string, allowWholeWord: boolean) =>
    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return 0;
      if (selection.anchor.type !== 'text') return 0;

      const anchorNode = selection.anchor.getNode();

      if (!$isTextNode(anchorNode)) return 0;

      return getWordReplaceLength(
        anchorNode.getTextContent(),
        selection.anchor.offset,
        replacementText,
        allowWholeWord,
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
    const synthetic = !inputEvent.isTrusted;
    const replacementText = getReplacementText(inputEvent);
    const { blocked, range: targetRange } = resolveTargetRange(inputEvent);
    const replaceLength =
      !targetRange && replacementText
        ? getInferredReplaceLength(replacementText, synthetic && isReplacement)
        : 0;

    if (blocked) {
      if (debugEnabled) debugPrint('decision: native (getTargetRanges throws)');
      setLexicalHandled(inputEvent);
      return;
    }

    if (isReplacement) {
      // Hand the event back to the browser when the edit cannot be safely re-done by
      // lexical: mid-composition, a trusted non-cancelable event (a real IME/autocorrect
      // acceptance the browser will apply itself), no payload (Chromium ≤142 sends
      // insertReplacementText with neither data nor dataTransfer), or no target to
      // replace. Synthetic events (browser-isolation thin clients, overlay extensions)
      // are NOT handed back: they have no native default action — nobody applies the
      // edit unless the editor does — so with a payload and a target they take the
      // controlled path below.
      const nativeFallback =
        composing ||
        (!synthetic && !inputEvent.cancelable) ||
        !replacementText ||
        (!targetRange && replaceLength === 0);

      if (nativeFallback) {
        if (debugEnabled)
          debugPrint(
            `decision: native-fallback (comp=${composing ? 1 : 0} trust=${
              inputEvent.isTrusted ? 1 : 0
            } cancel=${inputEvent.cancelable ? 1 : 0} payload=${
              replacementText === null ? 0 : 1
            } range=${targetRange === null ? 0 : 1} replace=${replaceLength})`,
          );
        setLexicalHandled(inputEvent);
        return;
      }
    } else if (composing) {
      return;
    }

    // Only repair the selection; lexical's own beforeinput handler performs the
    // preventDefault and the controlled insertion.
    if (targetRange) {
      if (debugEnabled)
        debugPrint(`decision: controlled (target-range path, synth=${synthetic ? 1 : 0})`);
      applyRangeIfSelectionStale(targetRange);
    } else if (replaceLength > 0) {
      if (debugEnabled)
        debugPrint(`decision: controlled (replace=${replaceLength}, synth=${synthetic ? 1 : 0})`);
      selectTypedPrefix(replaceLength);
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

    // A prevented trusted beforeinput produces no input event in compliant browsers.
    // Synthetic injectors dispatch a paired input event regardless (and their events
    // can never be default-prevented), so those are matched by trust instead.
    const syntheticPair = !armed.event.isTrusted && !inputEvent.isTrusted;

    if (!syntheticPair && !armed.event.defaultPrevented) return;
    if (inputEvent.timeStamp - armed.timeStamp > 100) return;

    // The model already holds the controlled insertion; stop lexical's input handler
    // from processing this event — both its data path (a second controlled insert) and
    // its DOM-sync path (importing a doubled DOM) would duplicate the suggestion.
    setLexicalHandled(inputEvent);

    if (debugEnabled)
      debugPrint(
        `input suppressed (${syntheticPair ? 'synthetic pair' : 'prevented edit still fired'})`,
      );

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

    if (debugEnabled) debugPrint('guard: DOM diverged from model — repairing from model');
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
    debugPrint(describeEvent(event, editor));
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
      if (debugEnabled) debugPrint(`command: replacement insert ${JSON.stringify(text)}`);

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
        debugEnabled = isDebugEnabled();
        nextRootElement.addEventListener('beforeinput', handleBeforeInput, true);
        nextRootElement.addEventListener('input', handleInput, true);

        if (debugEnabled)
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
