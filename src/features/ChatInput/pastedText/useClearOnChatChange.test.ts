import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';

import { usePastedTextStore } from './store';
import { useClearPastedTextsOnChatChange } from './useClearOnChatChange';

describe('useClearPastedTextsOnChatChange', () => {
  beforeEach(() => {
    usePastedTextStore.getState().clearPastedTexts();
    useChatStore.setState({ activeId: 'session-a', activeTopicId: 'topic-a' });
  });

  it('keeps chips on the first mount of the same conversation', () => {
    usePastedTextStore.getState().addPastedText('keep');
    renderHook(() => useClearPastedTextsOnChatChange());
    expect(usePastedTextStore.getState().items).toHaveLength(1);
  });

  it('clears chips when the session or topic changes', () => {
    usePastedTextStore.getState().addPastedText('stale');
    const { rerender } = renderHook(() => useClearPastedTextsOnChatChange());

    act(() => {
      useChatStore.setState({ activeId: 'session-a', activeTopicId: 'topic-b' });
    });
    rerender();

    expect(usePastedTextStore.getState().items).toEqual([]);
  });
});
