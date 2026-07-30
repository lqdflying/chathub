import { describe, expect, it } from 'vitest';

import { useSessionStore } from '@/store/session';

import { isGroupSessionContext } from './isGroupSessionContext';

const setSession = (session: { id: string; type: string }) => {
  useSessionStore.setState({ activeId: session.id, sessions: [session] as any });
};

describe('isGroupSessionContext', () => {
  it('trusts an explicit group session type', () => {
    setSession({ id: 'agent-1', type: 'agent' });

    expect(isGroupSessionContext('group')).toBe(true);
  });

  it('trusts an explicit agent session type even when the session store holds a group', () => {
    setSession({ id: 'group-1', type: 'group' });

    expect(isGroupSessionContext('agent')).toBe(false);
  });

  it('falls back to the session store while the type is unresolved', () => {
    setSession({ id: 'group-1', type: 'group' });

    expect(isGroupSessionContext(undefined)).toBe(true);
  });

  it('resolves to false when the unresolved session is not a group', () => {
    setSession({ id: 'agent-1', type: 'agent' });

    expect(isGroupSessionContext(undefined)).toBe(false);
  });
});
