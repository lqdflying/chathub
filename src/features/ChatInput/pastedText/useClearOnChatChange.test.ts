import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';

import { MAIN_PASTED_TEXT_SCOPE, getThreadPastedTextScope } from './scope';
import { selectPastedTextItems, usePastedTextStore } from './store';
import {
  useClearPastedTextsOnChatChange,
  useClearPastedTextsOnScopeChange,
} from './useClearOnChatChange';

describe('useClearPastedTextsOnChatChange', () => {
  beforeEach(() => {
    usePastedTextStore.getState().clearAllPastedTexts();
    useChatStore.setState({ activeId: 'session-a', activeTopicId: 'topic-a' });
  });

  it('keeps chips on the first mount of the same conversation', () => {
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'keep');
    renderHook(() => useClearPastedTextsOnChatChange());
    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      1,
    );
  });

  it('clears chips when the session or topic changes', () => {
    const threadScope = getThreadPastedTextScope('portal-a');
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'stale');
    usePastedTextStore.getState().addPastedText(threadScope, 'thread stale');
    const { rerender } = renderHook(() => useClearPastedTextsOnChatChange());

    act(() => {
      useChatStore.setState({ activeId: 'session-a', activeTopicId: 'topic-b' });
    });
    rerender();

    expect(usePastedTextStore.getState().itemsByScope).toEqual({});
  });
});

describe('useClearPastedTextsOnScopeChange', () => {
  beforeEach(() => {
    usePastedTextStore.getState().clearAllPastedTexts();
  });

  it('clears only the previous thread when the portal thread changes', () => {
    const firstThread = getThreadPastedTextScope('portal-a');
    const secondThread = getThreadPastedTextScope('portal-b');
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'main dump');
    usePastedTextStore.getState().addPastedText(firstThread, 'thread a dump');

    const { rerender } = renderHook(({ scope }) => useClearPastedTextsOnScopeChange(scope), {
      initialProps: { scope: firstThread },
    });

    rerender({ scope: secondThread });

    expect(selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState())).toHaveLength(
      1,
    );
    expect(selectPastedTextItems(firstThread)(usePastedTextStore.getState())).toEqual([]);
    expect(selectPastedTextItems(secondThread)(usePastedTextStore.getState())).toEqual([]);
  });
});
