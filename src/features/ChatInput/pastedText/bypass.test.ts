import { describe, expect, it } from 'vitest';

import { createShiftPasteBypassTracker, isShiftModifierPasteShortcut } from './bypass';

describe('shift-paste bypass tracker', () => {
  it('recognizes Ctrl/Cmd+Shift+V and ignores Ctrl+V', () => {
    expect(
      isShiftModifierPasteShortcut(
        new KeyboardEvent('keydown', { ctrlKey: true, key: 'v', shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      isShiftModifierPasteShortcut(
        new KeyboardEvent('keydown', { key: 'v', metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      isShiftModifierPasteShortcut(new KeyboardEvent('keydown', { ctrlKey: true, key: 'v' })),
    ).toBe(false);
  });

  it('arms on the shortcut keydown and consumes once on paste', () => {
    const tracker = createShiftPasteBypassTracker();
    tracker.onKeyDown(new KeyboardEvent('keydown', { ctrlKey: true, key: 'v', shiftKey: true }));
    expect(tracker.consumeBypass()).toBe(true);
    expect(tracker.consumeBypass()).toBe(false);
  });

  it('cancels an unused shortcut on keyup of V', () => {
    const tracker = createShiftPasteBypassTracker();
    tracker.onKeyDown(new KeyboardEvent('keydown', { ctrlKey: true, key: 'v', shiftKey: true }));
    tracker.onKeyUp(new KeyboardEvent('keyup', { key: 'v' }));
    expect(tracker.consumeBypass()).toBe(false);
  });
});
