import { describe, expect, it } from 'vitest';

import { clearPendingPastedTexts, joinInputWithPendingPastedTexts } from './send';
import { usePastedTextStore } from './store';

describe('pasted text store', () => {
  it('adds, removes, and clears pending chips', () => {
    usePastedTextStore.getState().clearPastedTexts();
    const first = usePastedTextStore.getState().addPastedText('one');
    const second = usePastedTextStore.getState().addPastedText('two');

    expect(usePastedTextStore.getState().items.map((item) => item.content)).toEqual(['one', 'two']);

    usePastedTextStore.getState().removePastedText(first);
    expect(usePastedTextStore.getState().items.map((item) => item.id)).toEqual([second]);

    usePastedTextStore.getState().clearPastedTexts();
    expect(usePastedTextStore.getState().items).toEqual([]);
  });

  it('joins pending chips for send and can clear them afterwards', () => {
    usePastedTextStore.getState().clearPastedTexts();
    usePastedTextStore.getState().addPastedText('dump');

    expect(joinInputWithPendingPastedTexts('prompt')).toBe('prompt\n\ndump');
    clearPendingPastedTexts();
    expect(usePastedTextStore.getState().items).toEqual([]);
  });
});
