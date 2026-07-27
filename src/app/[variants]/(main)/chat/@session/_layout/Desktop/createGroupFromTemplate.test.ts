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

describe('createGroupFromTemplate', () => {
  it('suppresses success when the account changes during the atomic request', async () => {
    let currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const groupCreated = createDeferred<string>();
    const createGroup = vi.fn().mockReturnValue(groupCreated.promise);
    const creationPromise = createGroupFromTemplate({
      createGroup,
      getCurrentScope: () => currentScope,
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members,
    });

    currentScope = {
      chatGroupGeneration: 1,
      sessionGeneration: 1,
      userScope: 'user:account-b',
    };
    groupCreated.resolve('account-a-group');

    await expect(creationPromise).resolves.toBe('');
    expect(createGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects an A-to-B-to-A reset with a different generation', async () => {
    let currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const groupCreated = createDeferred<string>();
    const createGroup = vi.fn().mockReturnValue(groupCreated.promise);
    const creationPromise = createGroupFromTemplate({
      createGroup,
      getCurrentScope: () => currentScope,
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members: members.slice(0, 1),
    });

    currentScope = {
      chatGroupGeneration: 2,
      sessionGeneration: 2,
      userScope: 'user:account-a',
    };
    groupCreated.resolve('account-a-group');

    await expect(creationPromise).resolves.toBe('');
    expect(createGroup).toHaveBeenCalledTimes(1);
  });

  it('submits all prepared virtual sessions in one request', async () => {
    const currentScope = {
      chatGroupGeneration: 0,
      sessionGeneration: 0,
      userScope: 'user:account-a',
    };
    const createGroup = vi.fn().mockResolvedValue('group-id');

    const groupId = await createGroupFromTemplate({
      createGroup,
      defaultAgentSettings: {
        config: {
          model: 'default-model',
          provider: 'default-provider',
        },
        meta: {
          backgroundColor: 'default-background',
        },
      },
      getCurrentScope: () => currentScope,
      group: { title: 'Template group' },
      groupDescription: 'Template description',
      members,
    });

    expect(groupId).toBe('group-id');
    expect(createGroup).toHaveBeenCalledTimes(1);
    expect(createGroup).toHaveBeenCalledWith({ title: 'Template group' }, undefined, false, [
      {
        config: expect.objectContaining({
          avatar: 'member-one-avatar',
          backgroundColor: 'default-background',
          description: 'Member one - Template description',
          model: 'default-model',
          provider: 'default-provider',
          systemRole: 'Member one role',
          title: 'Member one',
          virtual: true,
        }),
        session: expect.objectContaining({
          type: 'agent',
        }),
      },
      {
        config: expect.objectContaining({
          avatar: 'member-two-avatar',
          backgroundColor: 'default-background',
          description: 'Member two - Template description',
          model: 'default-model',
          provider: 'default-provider',
          systemRole: 'Member two role',
          title: 'Member two',
          virtual: true,
        }),
        session: expect.objectContaining({
          type: 'agent',
        }),
      },
    ]);
  });
});
