import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { ChatGroupModel } from '@/database/models/chatGroup';

import { groupRouter } from '../group';

vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/chatGroup');

describe('groupRouter', () => {
  const createWithMembers = vi.fn();
  const removeAgentsFromGroup = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(ChatGroupModel).mockImplementation(
      () => ({ createWithMembers, removeAgentsFromGroup, update }) as never,
    );
  });

  it('creates an ordinary group through one authenticated atomic model call', async () => {
    createWithMembers.mockResolvedValue({
      group: {
        id: 'created-group',
        title: 'Created Group',
        userId: 'account-a',
      },
      virtualMembers: [],
    });
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(
      caller.createGroup({
        agentIds: ['agent-one', 'agent-two'],
        group: {
          config: { enableSupervisor: false },
          title: 'Created Group',
        },
      }),
    ).resolves.toMatchObject({
      group: { id: 'created-group' },
      virtualMembers: [],
    });

    expect(ChatGroupModel).toHaveBeenCalledWith({}, 'account-a');
    expect(createWithMembers).toHaveBeenCalledTimes(1);
    expect(createWithMembers).toHaveBeenCalledWith({
      agentIds: ['agent-one', 'agent-two'],
      group: {
        config: expect.objectContaining({ enableSupervisor: false }),
        title: 'Created Group',
      },
    });
  });

  it('passes normalized virtual sessions through one atomic model call', async () => {
    createWithMembers.mockResolvedValue({
      group: {
        id: 'template-group',
        title: 'Template Group',
        userId: 'account-a',
      },
      virtualMembers: [{ agentId: 'virtual-agent', sessionId: 'virtual-session' }],
    });
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await caller.createGroup({
      group: { title: 'Template Group' },
      virtualSessions: [
        {
          config: {
            plugins: ['template-plugin'],
            systemRole: 'Template role',
            virtual: true,
          },
          session: {
            avatar: 'template-avatar',
            title: 'Template Member',
          },
        },
      ],
    });

    expect(createWithMembers).toHaveBeenCalledTimes(1);
    expect(createWithMembers).toHaveBeenCalledWith({
      group: { config: undefined, title: 'Template Group' },
      virtualSessions: [
        {
          config: {
            plugins: ['template-plugin'],
            systemRole: 'Template role',
            virtual: true,
          },
          session: {
            avatar: 'template-avatar',
            title: 'Template Member',
          },
        },
      ],
    });
  });

  it('rejects ownership fields in atomic group creation input', async () => {
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(
      caller.createGroup({
        group: {
          title: 'Injected Group',
          userId: 'account-b',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createWithMembers).not.toHaveBeenCalled();
  });

  it('removes multiple members through one atomic model call', async () => {
    removeAgentsFromGroup.mockResolvedValue(undefined);
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(
      caller.removeAgentsFromGroup({
        agentIds: ['agent-one', 'agent-two'],
        groupId: 'owned-group',
      }),
    ).resolves.toBeUndefined();

    expect(removeAgentsFromGroup).toHaveBeenCalledTimes(1);
    expect(removeAgentsFromGroup).toHaveBeenCalledWith('owned-group', ['agent-one', 'agent-two']);
  });

  it('rejects attempts to reassign group ownership', async () => {
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(
      caller.updateGroup({
        id: 'owned-group',
        value: { userId: 'account-b' },
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects attempts to replace the group identity through the update value', async () => {
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await expect(
      caller.updateGroup({
        id: 'owned-group',
        value: { id: 'other-group' },
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(update).not.toHaveBeenCalled();
  });

  it('passes only mutable group fields to the authenticated model', async () => {
    update.mockResolvedValue({
      id: 'owned-group',
      title: 'Updated title',
      userId: 'account-a',
    });
    const caller = groupRouter.createCaller({
      clerkAuth: { userId: 'account-a' },
      userId: 'account-a',
    } as never);

    await caller.updateGroup({
      id: 'owned-group',
      value: { pinned: true, title: 'Updated title' },
    });

    expect(ChatGroupModel).toHaveBeenCalledWith({}, 'account-a');
    expect(update).toHaveBeenCalledWith('owned-group', {
      config: undefined,
      pinned: true,
      title: 'Updated title',
    });
  });
});
