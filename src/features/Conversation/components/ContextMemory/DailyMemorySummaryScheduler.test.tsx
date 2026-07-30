import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { authSelectors } from '@/store/user/selectors';

import DailyMemorySummaryScheduler from './DailyMemorySummaryScheduler';

const CHECK_MS = 120_000;

describe('DailyMemorySummaryScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
      enableCompressHistory: true,
      enableDailyMemorySummary: true,
      enableHistoryCount: true,
    } as any);
    vi.spyOn(agentChatConfigSelectors, 'enableHistoryCount').mockReturnValue(true);
    vi.spyOn(authSelectors, 'currentUserScope').mockReturnValue('user:account-a');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('skips a group session via the session store while activeSessionType is unresolved', async () => {
    const trigger = vi.fn(async () => ({ status: 'compacted' }) as any);
    useChatStore.setState({
      activeId: 'group-1',
      activeSessionType: undefined,
      activeThreadId: undefined,
      activeTopicId: 'topic-1',
      portalThreadId: undefined,
      triggerScheduledMemoryCompaction: trigger,
    });
    useSessionStore.setState({
      activeId: 'group-1',
      sessions: [{ id: 'group-1', type: 'group' }] as any,
    });

    render(<DailyMemorySummaryScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(trigger).not.toHaveBeenCalled();

    // once the active session is an agent one, the same unresolved window runs the summary
    useSessionStore.setState({
      activeId: 'agent-1',
      sessions: [{ id: 'agent-1', type: 'agent' }] as any,
    });
    useChatStore.setState({ activeId: 'agent-1' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
