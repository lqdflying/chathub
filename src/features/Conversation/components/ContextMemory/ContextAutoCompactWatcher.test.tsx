import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as compactionDebugClient from '@/libs/logger/compactionDebugClient';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ContextAutoCompactWatcher from './ContextAutoCompactWatcher';

const usage = vi.hoisted(() => ({
  knowledgeBaseToken: 40,
  maxTokens: 1000,
  ratio: 0.9,
  totalToken: 900,
}));

vi.mock('@/hooks/useEstimatedContextUsage', () => ({
  useEstimatedContextUsage: () => usage,
}));

const COMPACTION_DEBOUNCE_MS = 750;

describe('ContextAutoCompactWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usage.knowledgeBaseToken = 40;
    usage.maxTokens = 1000;
    usage.ratio = 0.9;
    usage.totalToken = 900;
    vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
      contextCompactThreshold: 0.8,
      enableCompressHistory: true,
      enableHistoryCount: true,
      enableTokenThresholdAutoCompact: true,
    } as any);
    vi.spyOn(agentChatConfigSelectors, 'enableHistoryCount').mockReturnValue(true);
    vi.spyOn(agentChatConfigSelectors, 'enableTokenThresholdAutoCompact').mockReturnValue(true);
    vi.spyOn(agentChatConfigSelectors, 'contextCompactThreshold').mockReturnValue(0.8);
    useChatStore.setState({
      activeId: 'session-1',
      activeSessionType: 'agent',
      activeThreadId: undefined,
      activeTopicId: 'topic-1',
      chatLoadingIds: [],
      isCreatingMessage: false,
      portalThreadId: undefined,
      triggerTokenThresholdMemoryCompaction: vi.fn(async () => ({ status: 'compacted' }) as any),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits watcher_armed only when it schedules a token-threshold attempt', async () => {
    const armed = vi
      .spyOn(compactionDebugClient, 'logCompactionWatcherArmed')
      .mockResolvedValue(undefined);
    const trigger = useChatStore.getState().triggerTokenThresholdMemoryCompaction as ReturnType<
      typeof vi.fn
    >;

    usage.ratio = 0.5;
    const { rerender } = render(<ContextAutoCompactWatcher />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });
    expect(armed).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();

    usage.ratio = 0.9;
    rerender(<ContextAutoCompactWatcher />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });

    expect(armed).toHaveBeenCalledTimes(1);
    expect(armed).toHaveBeenCalledWith({
      highWatermark: 0.8,
      knowledgeBaseToken: 40,
      maxTokens: 1000,
      ratio: 0.9,
      sessionId: 'session-1',
      topicId: 'topic-1',
      totalToken: 900,
    });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('does not emit watcher_armed when the debounce is cleared before it fires', async () => {
    const armed = vi
      .spyOn(compactionDebugClient, 'logCompactionWatcherArmed')
      .mockResolvedValue(undefined);

    const { unmount } = render(<ContextAutoCompactWatcher />);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });

    expect(armed).not.toHaveBeenCalled();
  });

  it('does not re-arm target_unreachable on an unchanged fingerprint', async () => {
    const trigger = vi.fn(async () => ({ status: 'target_unreachable' }));
    useChatStore.setState({ triggerTokenThresholdMemoryCompaction: trigger as any });
    render(<ContextAutoCompactWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });
    expect(trigger).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('re-arms a failed compact after backoff', async () => {
    const trigger = vi.fn(async () => ({ status: 'failed' }));
    useChatStore.setState({ triggerTokenThresholdMemoryCompaction: trigger as any });
    render(<ContextAutoCompactWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
      await trigger.mock.results[0]?.value;
    });
    expect(trigger).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
      await trigger.mock.results[1]?.value;
    });
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('arms again after target_unreachable when the conversation fingerprint changes', async () => {
    const trigger = vi.fn(async () => ({ status: 'target_unreachable' }));
    useChatStore.setState({ triggerTokenThresholdMemoryCompaction: trigger as any });
    const { rerender } = render(<ContextAutoCompactWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });
    expect(trigger).toHaveBeenCalledTimes(1);

    act(() => {
      useChatStore.setState({
        messagesMap: {
          [messageMapKey('session-1', 'topic-1')]: [
            { content: 'next', id: 'u1', role: 'user', updatedAt: 1 } as any,
          ],
        },
      });
    });
    rerender(<ContextAutoCompactWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPACTION_DEBOUNCE_MS);
    });
    expect(trigger).toHaveBeenCalledTimes(2);
  });
});
