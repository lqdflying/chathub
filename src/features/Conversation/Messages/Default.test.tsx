import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { DefaultMessage } from './Default';

vi.stubGlobal('React', React);

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

vi.mock('@/components/BubblesLoading', () => ({
  default: () => <div data-testid="bubbles-loading" />,
}));

const ASSISTANT_ID = 'assistant-1';

const hasBubbles = () => screen.queryByTestId('bubbles-loading') !== null;

const renderPlaceholder = () =>
  render(
    <DefaultMessage
      content={LOADING_FLAT}
      createdAt={Date.now() - 60_000}
      editableContent={<div>editable</div>}
      id={ASSISTANT_ID}
      meta={{ avatar: '', backgroundColor: '', description: '', tags: [], title: '' }}
      role="assistant"
      updatedAt={Date.now()}
    />,
  );

describe('DefaultMessage InterruptibleLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.setState({
      chatLoadingIds: [],
      messageEditingIds: [],
      serverGenerationOperations: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows bubbles for a fresh LOADING_FLAT placeholder even when not generating', () => {
    renderPlaceholder();
    expect(hasBubbles()).toBe(true);
  });

  it('hides a leftover LOADING_FLAT placeholder after the stale timeout', () => {
    renderPlaceholder();

    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(hasBubbles()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hasBubbles()).toBe(false);
  });

  it('keeps bubbles while an attached server job owns the assistant row', () => {
    useChatStore.setState({
      serverGenerationOperations: {
        [messageMapKey('session-1', 'topic-1')]: {
          cgo_one: {
            assistantMessageId: ASSISTANT_ID,
            generation: 0,
            kind: 'chat',
            lane: 'lane-main',
            operationId: 'cgo_one',
            sessionId: 'session-1',
            topicId: 'topic-1',
            userScope: 'current',
          },
        },
      },
    });

    renderPlaceholder();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(hasBubbles()).toBe(true);
  });

  it('resets the stale timer when generation starts again', () => {
    renderPlaceholder();

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(hasBubbles()).toBe(false);

    act(() => {
      useChatStore.setState({ chatLoadingIds: [ASSISTANT_ID] });
    });
    expect(hasBubbles()).toBe(true);
  });
});
