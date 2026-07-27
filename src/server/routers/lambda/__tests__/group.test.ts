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
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(ChatGroupModel).mockImplementation(() => ({ update }) as never);
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
