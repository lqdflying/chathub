import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureLargePlainPaste } from './capture';
import { usePastedTextStore } from './store';

const largeText = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');

const createEvent = ({
  files = false,
  shiftKey = false,
  text = '',
}: {
  files?: boolean;
  shiftKey?: boolean;
  text?: string;
}) => {
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
    shiftKey,
    stopImmediatePropagation,
    stopPropagation,
  };
};

describe('captureLargePlainPaste', () => {
  beforeEach(() => {
    usePastedTextStore.getState().clearPastedTexts();
  });

  it('collapses a large plain-text paste into a pending chip', () => {
    const event = createEvent({ text: largeText });

    expect(captureLargePlainPaste(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(usePastedTextStore.getState().items).toHaveLength(1);
    expect(usePastedTextStore.getState().items[0]?.content).toBe(largeText);
  });

  it('pastes inline when Shift is held', () => {
    const event = createEvent({ shiftKey: true, text: largeText });

    expect(captureLargePlainPaste(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(usePastedTextStore.getState().items).toHaveLength(0);
  });

  it('ignores a clipboard that already contains files', () => {
    const event = createEvent({ files: true, text: largeText });

    expect(captureLargePlainPaste(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(usePastedTextStore.getState().items).toHaveLength(0);
  });

  it('leaves a short snippet in the editor', () => {
    const event = createEvent({ text: 'short\nsnippet' });

    expect(captureLargePlainPaste(event)).toBe(false);
    expect(usePastedTextStore.getState().items).toHaveLength(0);
  });
});
