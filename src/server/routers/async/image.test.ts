// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { UserModel } from '@/database/models/user';
import { logImageDebugSafe } from '@/libs/logger/imageDebug';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';

import { imageRouter } from './image';

const { mockClaimPendingTask, mockServerDB } = vi.hoisted(() => ({
  mockClaimPendingTask: vi.fn(),
  mockServerDB: {},
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: {
    KEY_VAULTS_SECRET: 'test-internal-secret',
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));

vi.mock('@/database/models/asyncTask');
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(),
}));
vi.mock('@/database/models/user');
vi.mock('@/libs/logger/imageDebug', () => ({
  describeImageDebugError: vi.fn(),
  fingerprintImageDebugValue: vi.fn(() => ({ hash: 'test-hash' })),
  logImageDebugSafe: vi.fn(),
  logImageDebugVerbose: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime');
vi.mock('@/server/services/generation', () => ({
  GenerationService: vi.fn(),
}));

describe('imageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserModel.findById).mockResolvedValue({ id: 'test-user' } as never);
    vi.mocked(AsyncTaskModel).mockImplementation(
      () =>
        ({
          claimPendingTask: mockClaimPendingTask,
        }) as never,
    );
  });

  it('does not initialize a provider when the pending task claim fails', async () => {
    mockClaimPendingTask.mockResolvedValue(false);

    const caller = imageRouter.createCaller({
      jwtPayload: { apiKey: 'test-key' },
      secret: 'test-internal-secret',
      userId: 'test-user',
    });

    const result = await caller.createImage({
      generationId: 'generation-1',
      model: 'image-model',
      params: { prompt: 'private prompt' },
      provider: 'custom-provider',
      taskId: 'task-1',
    });

    expect(result).toBeUndefined();
    expect(mockClaimPendingTask).toHaveBeenCalledOnce();
    expect(mockClaimPendingTask).toHaveBeenCalledWith('task-1');
    expect(initModelRuntimeWithUserPayload).not.toHaveBeenCalled();
    expect(logImageDebugSafe).not.toHaveBeenCalledWith(
      'async_task_started',
      expect.any(Object),
    );
  });
});
