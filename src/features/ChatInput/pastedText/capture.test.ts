import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createShiftPasteBypassTracker } from './bypass';
import { captureLargePlainPaste } from './capture';
import { MAIN_PASTED_TEXT_SCOPE, getThreadPastedTextScope } from './scope';
import { selectPastedTextItems, usePastedTextStore } from './store';

const largeText = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

const createEvent = ({ files = false, text = '' }: { files?: boolean; text?: string }) => {
  const preventDefault = vi.fn();
  const stopImmediatePropagation = vi.fn();
  const stopPropagation = vi.fn();

  return {
    clipboardData: {
      files: { length: files ? 1 : 0 },
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      items: files ? [{ kind: 'file' }] : [{ kind: 'string' }],
    } as unknown as DataTransfer,
    preventDefault,
    stopImmediatePropagation,
    stopPropagation,
  };
};

describe('captureLargePlainPaste', () => {
  beforeEach(() => {
    usePastedTextStore.getState().clearAllPastedTexts();
  });

  it('accepts a paste event without a shiftKey field', () => {
    const event = createEvent({ text: largeText });
    expect('shiftKey' in event).toBe(false);
    expect(captureLargePlainPaste(event, { scope: MAIN_PASTED_TEXT_SCOPE })).toBe(true);
  });

  it('collapses a large plain-text paste into a pending chip', () => {
    const event = createEvent({ text: largeText });

    expect(captureLargePlainPaste(event, { scope: MAIN_PASTED_TEXT_SCOPE })).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      1,
    );
    expect(
      selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())[0]?.content,
    ).toBe(largeText);
  });

  it('pastes inline after Ctrl+Shift+V or Cmd+Shift+V', () => {
    const tracker = createShiftPasteBypassTracker();
    tracker.onKeyDown(
      new KeyboardEvent('keydown', { ctrlKey: true, key: 'v', shiftKey: true }),
    );
    const event = createEvent({ text: largeText });

    expect(
      captureLargePlainPaste(event, {
        bypass: tracker.consumeBypass(),
        scope: MAIN_PASTED_TEXT_SCOPE,
      }),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      0,
    );

    tracker.onKeyDown(
      new KeyboardEvent('keydown', { key: 'v', metaKey: true, shiftKey: true }),
    );
    expect(
      captureLargePlainPaste(createEvent({ text: largeText }), {
        bypass: tracker.consumeBypass(),
        scope: MAIN_PASTED_TEXT_SCOPE,
      }),
    ).toBe(false);
  });

  it('does not treat an invented paste.shiftKey as a bypass', () => {
    const event = { ...createEvent({ text: largeText }), shiftKey: true };

    expect(captureLargePlainPaste(event, { scope: MAIN_PASTED_TEXT_SCOPE })).toBe(true);
  });

  it('stores a paste against the requested composer scope', () => {
    const threadScope = getThreadPastedTextScope('portal-thread');
    captureLargePlainPaste(createEvent({ text: largeText }), { scope: threadScope });

    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      0,
    );
    expect(selectPastedTextItems(threadScope)(usePastedTextStore.getState())).toHaveLength(1);
  });

  it('ignores a clipboard that already contains files', () => {
    const event = createEvent({ files: true, text: largeText });

    expect(captureLargePlainPaste(event, { scope: MAIN_PASTED_TEXT_SCOPE })).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves a short snippet in the editor', () => {
    const event = createEvent({ text: 'short\nsnippet' });

    expect(captureLargePlainPaste(event, { scope: MAIN_PASTED_TEXT_SCOPE })).toBe(false);
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      0,
    );
  });
});
