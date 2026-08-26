import { describe, expect, it } from 'vitest';

import { MAIN_PASTED_TEXT_SCOPE, getThreadPastedTextScope } from './scope';
import { clearPendingPastedTexts, joinInputWithPendingPastedTexts } from './send';
import { selectPastedTextItems, usePastedTextStore } from './store';

describe('pasted text store', () => {
  it('adds, removes, and clears pending chips for one composer', () => {
    usePastedTextStore.getState().clearAllPastedTexts();
    const first = usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'one');
    const second = usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'two');

    expect(
      selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState()).map(
        (item) => item.content,
      ),
    ).toEqual(['one', 'two']);

    usePastedTextStore.getState().removePastedText(MAIN_PASTED_TEXT_SCOPE, first);
    expect(
      selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState()).map(
        (item) => item.id,
      ),
    ).toEqual([second]);

    usePastedTextStore.getState().clearPastedTexts(MAIN_PASTED_TEXT_SCOPE);
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toEqual([]);
  });

  it('keeps main and portal-thread pastes isolated', () => {
    usePastedTextStore.getState().clearAllPastedTexts();
    const threadScope = getThreadPastedTextScope('portal-a');
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'main dump');
    usePastedTextStore.getState().addPastedText(threadScope, 'thread dump');

    expect(joinInputWithPendingPastedTexts('main prompt', MAIN_PASTED_TEXT_SCOPE)).toBe(
      'main prompt\n\nmain dump',
    );
    expect(joinInputWithPendingPastedTexts('thread prompt', threadScope)).toBe(
      'thread prompt\n\nthread dump',
    );

    clearPendingPastedTexts(MAIN_PASTED_TEXT_SCOPE);
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toEqual([]);
    expect(
      selectPastedTextItems(threadScope)(usePastedTextStore.getState()).map((item) => item.content),
    ).toEqual(['thread dump']);
  });

  it('does not carry a pending paste into another portal thread', () => {
    usePastedTextStore.getState().clearAllPastedTexts();
    const firstThread = getThreadPastedTextScope('portal-a');
    const secondThread = getThreadPastedTextScope('portal-b');
    usePastedTextStore.getState().addPastedText(firstThread, 'thread a dump');

    expect(joinInputWithPendingPastedTexts('', secondThread)).toBe('');
    expect(selectPastedTextItems(secondThread)(usePastedTextStore.getState())).toEqual([]);
  });
});
