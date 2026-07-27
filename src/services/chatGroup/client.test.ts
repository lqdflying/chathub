import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatGroupModel } from '@/database/models/chatGroup';

import { ClientService } from './client';

vi.mock('@/database/client/db', () => ({
  clientDB: {},
}));

vi.mock('@/database/models/chatGroup');

describe('ChatGroup ClientService', () => {
  const removeAgentsFromGroup = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ChatGroupModel).mockImplementation(() => ({ removeAgentsFromGroup }) as never);
  });

  it('delegates plural member removal to one model command', async () => {
    removeAgentsFromGroup.mockResolvedValue(undefined);
    const service = new ClientService('account-a');

    await expect(
      service.removeAgentsFromGroup('owned-group', ['agent-one', 'agent-two']),
    ).resolves.toBeUndefined();

    expect(ChatGroupModel).toHaveBeenCalledTimes(1);
    expect(removeAgentsFromGroup).toHaveBeenCalledTimes(1);
    expect(removeAgentsFromGroup).toHaveBeenCalledWith('owned-group', ['agent-one', 'agent-two']);
  });
});
