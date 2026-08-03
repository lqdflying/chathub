import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useSessionStore } from '@/store/session';
import { authSelectors } from '@/store/user/selectors';

import AssistantMemoryRollupScheduler from './AssistantMemoryRollupScheduler';

const CHECK_MS = 120_000;

const todayLocal = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const markerKey = (agentId: string) => `lobe_assistant_memory_rollup_user:account-a_${agentId}`;

describe('AssistantMemoryRollupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(agentChatConfigSelectors, 'currentChatConfig').mockReturnValue({
      enablePeriodicAssistantMemoryRollup: true,
    } as any);
    vi.spyOn(authSelectors, 'currentUserScope').mockReturnValue('user:account-a');
    useChatStore.setState({
      activeId: 'session-1',
      activeSessionType: 'agent',
    });
    useSessionStore.setState({
      activeId: 'session-1',
      sessions: [{ id: 'session-1', type: 'agent' }] as any,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('runs the rollup and writes an account-scoped local-day marker on success', async () => {
    const rollup = vi.fn(async () => ({ status: 'success' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);

    render(<AssistantMemoryRollupScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).toHaveBeenCalledTimes(1);
    expect(rollup).toHaveBeenCalledWith({ trigger: 'scheduled' });
    expect(localStorage.getItem(markerKey('agent-1'))).toBe(todayLocal());

    // marker written: no further run today
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).toHaveBeenCalledTimes(1);
  });

  it('writes the marker on a genuine no-op skip so it does not retry all day', async () => {
    const rollup = vi.fn(async () => ({ reason: 'no_changes', status: 'skipped' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);

    render(<AssistantMemoryRollupScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(markerKey('agent-1'))).toBe(todayLocal());
  });

  it('leaves the marker unwritten on failure and on backoff skips', async () => {
    const rollup = vi.fn(async () => ({ reason: 'boom', status: 'failed' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);

    render(<AssistantMemoryRollupScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(markerKey('agent-1'))).toBeNull();

    // failure did not write the marker, so the next tick retries (paced by the
    // action-level backoff, which reports a skipped/backoff result here)
    rollup.mockResolvedValue({ reason: 'backoff', status: 'skipped' } as any);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(markerKey('agent-1'))).toBeNull();
  });

  it('skips while the user scope is unresolved', async () => {
    vi.mocked(authSelectors.currentUserScope).mockReturnValue(undefined as any);
    const rollup = vi.fn(async () => ({ status: 'success' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);

    render(<AssistantMemoryRollupScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).not.toHaveBeenCalled();
  });

  it('skips group sessions', async () => {
    const rollup = vi.fn(async () => ({ status: 'success' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);
    useChatStore.setState({ activeSessionType: 'group' });

    render(<AssistantMemoryRollupScheduler />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS);
    });
    expect(rollup).not.toHaveBeenCalled();
  });

  it('keeps its interval across agent switches instead of resetting it', async () => {
    const rollup = vi.fn(async () => ({ status: 'success' }) as any);
    useAgentStore.setState({ activeAgentId: 'agent-1', rollupAssistantMemory: rollup } as any);

    render(<AssistantMemoryRollupScheduler />);

    // halfway through the interval the user switches to another agent — under the old
    // fingerprint-keyed effect this reset the timer, so frequent switchers never rolled up
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS / 2);
    });
    useAgentStore.setState({ activeAgentId: 'agent-2' } as any);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_MS / 2);
    });

    expect(rollup).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(markerKey('agent-2'))).toBe(todayLocal());
    expect(localStorage.getItem(markerKey('agent-1'))).toBeNull();
  });
});
