import type { LobeAgentSession } from '@/types/session';

import { createGroupFromTemplate } from './createGroupFromTemplate';

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

const members = [
  {
    avatar: 'member-one-avatar',
    systemRole: 'Member one role',
    title: 'Member one',
  },
  {
    avatar: 'member-two-avatar',
    systemRole: 'Member two role',
    title: 'Member two',
  },
];

const createAgentSession = (sessionId: string, agentId: string): LobeAgentSession =>
  ({
    config: { id: agentId },
    id: sessionId,
    type: 'agent',
  }) as LobeAgentSession;

describe('createGroupFromTemplate', () => {
  it('does not submit partial members after the account changes', async () => {
    let currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const createGroup = vi.fn();
    const createSession = vi
      .fn()
      .mockResolvedValueOnce('account-a-session-one')
      .mockImplementationOnce(async () => {
        currentScope = {
          chatGroupGeneration: 1,
          sessionGeneration: 1,
          userScope: 'user:account-b',
        };
        return 'account-b-session-two';
      });

    const groupId = await createGroupFromTemplate({
      createGroup,
      createSession,
      getCurrentScope: () => currentScope,
      getSessionById: (sessionId) => createAgentSession(sessionId, `${sessionId}-agent`),
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members,
      refreshSessions: vi.fn(),
    });

    expect(groupId).toBe('');
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('stops when the account changes while sessions refresh', async () => {
    let currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const refreshFinished = createDeferred<void>();
    const createGroup = vi.fn();
    const creationPromise = createGroupFromTemplate({
      createGroup,
      createSession: vi.fn().mockResolvedValue('account-a-session'),
      getCurrentScope: () => currentScope,
      getSessionById: (sessionId) => createAgentSession(sessionId, 'account-a-agent'),
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members: members.slice(0, 1),
      refreshSessions: vi.fn().mockReturnValue(refreshFinished.promise),
    });

    currentScope = {
      chatGroupGeneration: 1,
      sessionGeneration: 1,
      userScope: 'user:account-b',
    };
    refreshFinished.resolve();

    await expect(creationPromise).resolves.toBe('');
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('rejects an A-to-B-to-A reset with a different generation', async () => {
    let currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const sessionCreated = createDeferred<string>();
    const createGroup = vi.fn();
    const creationPromise = createGroupFromTemplate({
      createGroup,
      createSession: vi.fn().mockReturnValue(sessionCreated.promise),
      getCurrentScope: () => currentScope,
      getSessionById: (sessionId) => createAgentSession(sessionId, 'account-a-agent'),
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members: members.slice(0, 1),
      refreshSessions: vi.fn(),
    });

    currentScope = {
      chatGroupGeneration: 2,
      sessionGeneration: 2,
      userScope: 'user:account-a',
    };
    sessionCreated.resolve('account-a-session');

    await expect(creationPromise).resolves.toBe('');
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('submits all member IDs when the initiating scope remains current', async () => {
    const currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const createGroup = vi.fn().mockResolvedValue('group-id');
    const createSession = vi
      .fn()
      .mockResolvedValueOnce('account-a-session-one')
      .mockResolvedValueOnce('account-a-session-two');

    const groupId = await createGroupFromTemplate({
      createGroup,
      createSession,
      getCurrentScope: () => currentScope,
      getSessionById: (sessionId) => createAgentSession(sessionId, `${sessionId}-agent`),
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members,
      refreshSessions: vi.fn(),
    });

    expect(groupId).toBe('group-id');
    expect(createGroup).toHaveBeenCalledWith({ title: 'Template group' }, [
      'account-a-session-one-agent',
      'account-a-session-two-agent',
    ]);
  });
});
