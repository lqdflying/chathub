import { useLexicalEditor } from '@lobehub/editor';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from 'lexical';
import { memo } from 'react';

import { $isPrimerOnly, IME_PRIMER } from './imePrimer';

// The desktop and mobile layouts mark the element that holds the editor and its buttons.
const CHAT_INPUT_SELECTOR = '[data-chat-input]';
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
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Meta', 'Shift']);
const THIN_CLIENT_IME_FLAG = 'lobe_thin_client_ime';
// Long enough for the default action of the key or click that scheduled the primer.
const PRIME_DELAY = 50;

// Isolation thin clients can fill a synthetic event's dataTransfer with the UTF-8 bytes
// of the text, one byte per UTF-16 unit ("啊" arrives as "å\u0095\u008A"). The intact
// copy rides the paired input event's `data`, which arrives only after the controlled
// insertion has consumed this payload.
const decodeUtf8ByteString = (text: string) => {
  const codes = Array.from(text, (char) => char.codePointAt(0) ?? 0);

  if (codes.every((code) => code < 128) || codes.some((code) => code > 255)) return text;

  try {
    return new TextDecoder('utf8', { fatal: true }).decode(Uint8Array.from(codes));
  } catch {
    return text;
  }
};

const getReplacementText = (event: InputEvent) => {
  let transferredText: string | null = null;

  try {
    transferredText = event.dataTransfer?.getData('text/plain') ?? null;
  } catch {
    transferredText = null;
  }

  if (transferredText && !event.isTrusted) transferredText = decodeUtf8ByteString(transferredText);

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
let overlayKeySection: HTMLElement | null = null;
let overlayTailSection: HTMLElement | null = null;
let overlaySequence = 0;

// Two sections: `key` pins decisions and payload-carrying events (rare but decisive),
// so a single screenshot of the overlay always contains them even when high-volume
// echo events flood the scrolling tail.
const debugPrint = (rawLine: string, key = false) => {
  try {
    overlaySequence += 1;
    const line = `${overlaySequence} ${rawLine}`;

    // eslint-disable-next-line no-console
    console.debug('[ReplacementTextPlugin]', line);

    const doc = globalThis.document;

    if (!doc?.body) return;

    if (!overlayElement || !overlayElement.isConnected) {
      overlayElement = doc.createElement('div');
      overlayElement.id = DEBUG_OVERLAY_ID;
      overlayElement.style.cssText =
        'position:fixed;bottom:8px;right:8px;z-index:2147483647;max-width:46vw;' +
        'background:rgba(0,0,0,0.86);color:#7CFC00;font:11px/1.5 monospace;' +
        'padding:8px;border-radius:6px;white-space:pre-wrap;word-break:break-all;';
      const header = doc.createElement('div');
      header.textContent = 'replacement debug on (disable: ?replacement_debug=0)';
      overlayKeySection = doc.createElement('div');
      overlayKeySection.style.cssText =
        'border-block-end:1px solid #444;margin-block-end:4px;padding-block-end:4px;color:#FFD700;';
      overlayTailSection = doc.createElement('div');
      overlayTailSection.style.cssText = 'max-height:22vh;overflow:auto;';
      overlayElement.append(header, overlayKeySection, overlayTailSection);
      doc.body.append(overlayElement);
    }

    const entry = doc.createElement('div');
    entry.textContent = line;

    if (key && overlayKeySection) {
      overlayKeySection.append(entry);
      while (overlayKeySection.childElementCount > 14) overlayKeySection.firstElementChild?.remove();
    } else if (overlayTailSection) {
      overlayTailSection.append(entry);
      while (overlayTailSection.childElementCount > 50)
        overlayTailSection.firstElementChild?.remove();
      overlayTailSection.scrollTop = overlayTailSection.scrollHeight;
    }
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
  // Armed by a payload-less synthetic insertReplacementText beforeinput: some
  // injectors deliver the replacement text only on the paired input event.
  let pendingSyntheticApply: { timeStamp: number } | null = null;
  // An isolation thin client runs the IME locally: the editor sees no composition
  // events, only `Process` keydowns followed by synthetic replacement events.
  let imeKeyActive = false;
  // Such an IME has been seen in this browser profile; turns the primer on.
  let thinClientIme = false;
  let primeTimer: ReturnType<typeof setTimeout> | undefined;
  let debugEnabled = false;

  const getDocSnapshot = () => {
    try {
      const joined = editor
        .getEditorState()
        .read(() => $getRoot().getChildren().map((node) => node.getTextContent()).join('|'));

      return joined.length > 60 ? `…${joined.slice(-60)}` : joined;
    } catch {
      return '?';
    }
  };

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

  // Where a synthetic IME event points: 'caret' is the editor's own caret inside one of
  // its text nodes; 'unmapped' is a node the editor does not own, because the thin
  // client composes in a local node that has no counterpart here.
  const resolveImeTarget = (event: InputEvent): 'caret' | 'unmapped' | null => {
    let range: StaticRange | undefined;

    try {
      range = event.getTargetRanges?.()[0];
    } catch {
      return null;
    }

    if (!range) return null;

    const { collapsed, startContainer, startOffset } = range;

    return editor.read(() => {
      const node = $getNearestNodeFromDOMNode(startContainer);

      if (!$isTextNode(node)) return 'unmapped';

      const selection = $getSelection();

      return collapsed &&
        $isRangeSelection(selection) &&
        selection.isCollapsed() &&
        selection.anchor.key === node.getKey() &&
        selection.anchor.offset === startOffset
        ? 'caret'
        : null;
    });
  };

  // The thin client relays a composition only into a text node that already exists at
  // the caret. Composing where there is none (an empty box) reaches the editor as one
  // unmapped event and then nothing at all. So while the editor is focused and idle, a
  // caret outside any text node gets a zero-width text node to compose in.
  const prime = () => {
    if (!thinClientIme || imeKeyActive || !rootElement || editor.isComposing()) return;
    if (rootElement.ownerDocument.activeElement !== rootElement) return;

    let primed = false;

    editor.update(
      () => {
        const selection = $getSelection();

        if (
          !$isRangeSelection(selection) ||
          !selection.isCollapsed() ||
          selection.anchor.type !== 'element'
        )
          return;

        selection.insertText(IME_PRIMER);
        primed = true;
      },
      { discrete: true, tag: HISTORY_MERGE_TAG },
    );

    if (primed && debugEnabled) debugPrint(`decision: ime-prime doc="${getDocSnapshot()}"`, true);
  };

  const schedulePrime = () => {
    if (!thinClientIme) return;

    clearTimeout(primeTimer);
    primeTimer = setTimeout(prime, PRIME_DELAY);
  };

  // The primer must not reach a sent message, and it would stand between the line start
  // and a typed "/" or markdown shortcut. It leaves before any key the IME does not
  // consume and before any click.
  const stripPrimer = () => {
    if (!thinClientIme) return;

    let stripped = false;

    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || selection.anchor.type !== 'text') return;

        const node = selection.anchor.getNode();

        if (!$isTextNode(node) || !node.getTextContent().startsWith(IME_PRIMER)) return;

        stripped = true;

        if (node.getTextContentSize() === 1) {
          node.remove();
          return;
        }

        node.spliceText(0, 1, '');
        for (const point of [selection.anchor, selection.focus])
          if (point.key === node.getKey() && point.offset > 0)
            point.set(point.key, point.offset - 1, 'text');
      },
      { discrete: true, tag: HISTORY_MERGE_TAG },
    );

    if (stripped && debugEnabled) debugPrint(`decision: ime-strip doc="${getDocSnapshot()}"`, true);
  };

  const handleKeyDown = (event: Event) => {
    const { ctrlKey, key, metaKey } = event as KeyboardEvent;

    if (!key || MODIFIER_KEYS.has(key)) return;

    if (key === 'Process') {
      imeKeyActive = true;
      return;
    }

    // A key the IME did not consume means no composition is open any more.
    imeKeyActive = false;

    // Copy reads the page selection, which can lie in the messages while the box keeps
    // focus. Removing the primer would move that selection into the box first.
    if ((ctrlKey || metaKey) && key.toLowerCase() === 'c') return;

    stripPrimer();
  };

  // Where no ancestor is marked, every click counts as a click on the chat input.
  const isChatInputTarget = (target: EventTarget | null) => {
    const chatInput = rootElement?.closest(CHAT_INPUT_SELECTOR);

    return !chatInput || chatInput.contains(target as Node | null);
  };

  // A click ends a composition too. On the chat input it can read or move the document
  // (the send button, a format button, a new caret), so the primer leaves first. A click
  // elsewhere leaves a box that holds only the primer alone: removing the primer and
  // placing it again 50 ms later writes the caret into the editor twice, which collapses
  // a text selection being dragged in the messages. Once text follows the primer it
  // still leaves, because the send menu opens outside the chat input.
  const handlePointerDown = (event: Event) => {
    imeKeyActive = false;

    if (!isChatInputTarget(event.target) && editor.getEditorState().read($isPrimerOnly)) return;

    stripPrimer();
  };

  // Composition events mean the IME runs in this browser, not behind a thin client.
  const handleCompositionStart = () => {
    imeKeyActive = false;
  };

  const handleBeforeInput = (event: Event) => {
    const inputEvent = event as InputEvent;

    pendingTrusted = null;
    pendingSyntheticApply = null;

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
    const imeTarget =
      imeKeyActive && synthetic && isReplacement && !composing && replacementText && !targetRange
        ? resolveImeTarget(inputEvent)
        : null;
    // Word inference is for text suggestions. An IME event names its own target, and
    // guessing would replace the previous word with the first letter of the next one.
    const replaceLength =
      !targetRange && replacementText && !imeTarget
        ? getInferredReplaceLength(replacementText, synthetic && isReplacement)
        : 0;

    if (blocked) {
      if (debugEnabled) debugPrint(`decision: native (getTargetRanges throws) doc="${getDocSnapshot()}"`, true);
      setLexicalHandled(inputEvent);
      return;
    }

    if (imeKeyActive && synthetic && isReplacement && replacementText && !thinClientIme) {
      thinClientIme = true;
      try {
        globalThis.localStorage?.setItem(THIN_CLIENT_IME_FLAG, '1');
      } catch {
        // The primer still works for this page load.
      }
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
        (!targetRange && replaceLength === 0 && imeTarget !== 'caret');

      if (nativeFallback) {
        if (debugEnabled)
          debugPrint(
            `decision: native-fallback (comp=${composing ? 1 : 0} trust=${
              inputEvent.isTrusted ? 1 : 0
            } cancel=${inputEvent.cancelable ? 1 : 0} payload=${
              replacementText === null ? 0 : 1
            } range=${targetRange === null ? 0 : 1} replace=${replaceLength}) doc="${getDocSnapshot()}"`,
            true,
          );
        setLexicalHandled(inputEvent);

        if (synthetic && !composing && !replacementText)
          pendingSyntheticApply = { timeStamp: inputEvent.timeStamp };

        return;
      }
    } else if (composing) {
      return;
    }

    // Only repair the selection; lexical's own beforeinput handler performs the
    // preventDefault and the controlled insertion.
    if (targetRange) {
      if (debugEnabled)
        debugPrint(
          `decision: controlled (target-range path, synth=${synthetic ? 1 : 0}) doc="${getDocSnapshot()}"`,
          true,
        );
      applyRangeIfSelectionStale(targetRange);
    } else if (replaceLength > 0) {
      if (debugEnabled)
        debugPrint(
          `decision: controlled (replace=${replaceLength}, synth=${synthetic ? 1 : 0}) doc="${getDocSnapshot()}"`,
          true,
        );
      selectTypedPrefix(replaceLength);
    } else if (imeTarget === 'caret') {
      if (debugEnabled)
        debugPrint(`decision: controlled (ime caret) doc="${getDocSnapshot()}"`, true);
    } else {
      return;
    }

    pendingTrusted = { event: inputEvent, timeStamp: inputEvent.timeStamp };
  };

  const applySyntheticReplacement = (rawData: string) => {
    const text = rawData.replace(/(?:\r?\n)+$/u, '').replaceAll(/\r?\n/gu, ' ');

    if (!text) return;

    editor.update(
      () => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) return;

        if (selection.isCollapsed() && selection.anchor.type === 'text') {
          const anchorNode = selection.anchor.getNode();

          if ($isTextNode(anchorNode)) {
            const content = anchorNode.getTextContent();
            const before = content.slice(0, selection.anchor.offset);

            // Injectors can deliver the same acceptance more than once; repeated
            // application must stay idempotent.
            if (before.endsWith(rawData) || before.endsWith(text)) return;

            const replaceLength = getWordReplaceLength(
              content,
              selection.anchor.offset,
              text,
              true,
            );

            if (replaceLength > 0)
              selection.setTextNodeRange(
                anchorNode,
                selection.anchor.offset - replaceLength,
                anchorNode,
                selection.anchor.offset,
              );
          }
        }

        selection.insertText(text);
      },
      { discrete: true },
    );
  };

  const handleInput = (event: Event) => {
    const armed = pendingTrusted;
    const armedSynthetic = pendingSyntheticApply;

    pendingTrusted = null;
    pendingSyntheticApply = null;

    const inputEvent = event as InputEvent;

    if (!isEditorTarget(inputEvent.target)) return;

    if (!armed) {
      // Payload-on-input shape: a payload-less synthetic replacement beforeinput was
      // flagged away from lexical, and the acceptance text arrives only here.
      if (
        armedSynthetic &&
        !inputEvent.isTrusted &&
        inputEvent.inputType === 'insertReplacementText' &&
        inputEvent.timeStamp - armedSynthetic.timeStamp <= 100
      ) {
        const data = getReplacementText(inputEvent);

        if (data) {
          setLexicalHandled(inputEvent);
          if (debugEnabled)
            debugPrint(
              `decision: synthetic input apply ${JSON.stringify(data)} doc="${getDocSnapshot()}"`,
              true,
            );
          applySyntheticReplacement(data);
          if (debugEnabled) debugPrint(`applied doc="${getDocSnapshot()}"`, true);
        }
      }

      return;
    }

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
        `input suppressed (${syntheticPair ? 'synthetic pair' : 'prevented edit still fired'}) doc="${getDocSnapshot()}"`,
        true,
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

    if (debugEnabled) debugPrint(`guard: DOM diverged from model — repairing doc="${getDocSnapshot()}"`, true);
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
    const line = describeEvent(event, editor);

    debugPrint(line, /(?:data|plain)="[^"]/.test(line));
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
      if (debugEnabled) debugPrint(`command: replacement insert ${JSON.stringify(text)}`, true);

      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );

  const unregisterRootListener = editor.registerRootListener(
    (nextRootElement, previousRootElement) => {
      pendingTrusted = null;
      pendingSyntheticApply = null;
      imeKeyActive = false;
      clearTimeout(primeTimer);

      if (previousRootElement) {
        previousRootElement.removeEventListener('beforeinput', handleBeforeInput, true);
        previousRootElement.removeEventListener('input', handleInput, true);
        previousRootElement.removeEventListener('keydown', handleKeyDown, true);
        previousRootElement.removeEventListener('compositionstart', handleCompositionStart, true);
        previousRootElement.removeEventListener('focus', schedulePrime, true);
        previousRootElement.ownerDocument.removeEventListener(
          'pointerdown',
          handlePointerDown,
          true,
        );
        for (const type of PROBE_EVENTS)
          previousRootElement.removeEventListener(type, handleProbe, true);
      }

      if (nextRootElement) {
        debugEnabled = isDebugEnabled();
        nextRootElement.addEventListener('beforeinput', handleBeforeInput, true);
        nextRootElement.addEventListener('input', handleInput, true);
        nextRootElement.addEventListener('keydown', handleKeyDown, true);
        nextRootElement.addEventListener('compositionstart', handleCompositionStart, true);
        nextRootElement.addEventListener('focus', schedulePrime, true);
        nextRootElement.ownerDocument.addEventListener('pointerdown', handlePointerDown, true);
        try {
          thinClientIme = globalThis.localStorage?.getItem(THIN_CLIENT_IME_FLAG) === '1';
        } catch {
          thinClientIme = false;
        }

        if (debugEnabled)
          for (const type of PROBE_EVENTS) nextRootElement.addEventListener(type, handleProbe, true);
      }

      rootElement = nextRootElement;
    },
  );

  // Sending or deleting can leave the caret without a text node again.
  const unregisterUpdateListener = editor.registerUpdateListener(schedulePrime);

  return () => {
    unregisterUpdateListener();
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
