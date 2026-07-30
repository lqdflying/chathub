import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatGroupStore } from '@/store/chatGroup';
import { useSessionStore } from '@/store/session';

import { useEnable } from './hook';

const groupSession = { id: 'group-a', type: 'group' };
const agentSession = { id: 'assistant-a', type: 'agent' };

const setSession = (session: { id: string; type: string }) => {
  useSessionStore.setState({ activeId: session.id, sessions: [session] as any });
};

describe('GroupThread useEnable', () => {
  beforeEach(() => {
    useChatGroupStore.setState({ activeThreadAgentId: '' });
  });

  it('is enabled when a thread agent is selected in a group session', () => {
    setSession(groupSession);
    useChatGroupStore.setState({ activeThreadAgentId: 'agent-x' });

    const { result } = renderHook(() => useEnable());
    expect(result.current).toBe(true);
  });

  it('is disabled when a stale thread agent lingers over a non-group session', () => {
    setSession(agentSession);
    useChatGroupStore.setState({ activeThreadAgentId: 'agent-x' });

    const { result } = renderHook(() => useEnable());
    expect(result.current).toBe(false);
  });

  it('is disabled when no thread agent is selected', () => {
    setSession(groupSession);

    const { result } = renderHook(() => useEnable());
    expect(result.current).toBe(false);
  });
});
