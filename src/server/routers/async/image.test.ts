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
    expect(logImageDebugSafe).not.toHaveBeenCalledWith('async_task_started', expect.any(Object));
  });

  describe('createChatImage', () => {
    it('generates server-side, creates the task-linked file, and marks the task successful', async () => {
      mockClaimPendingTask.mockResolvedValue(true);
      const updateTask = vi.fn().mockResolvedValue(undefined);
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ claimPendingTask: mockClaimPendingTask, update: updateTask }) as never,
      );
      const createImage = vi.fn().mockResolvedValue({
        height: 4096,
        imageUrl: 'data:image/png;base64,AAAA',
        width: 4096,
      });
      vi.mocked(initModelRuntimeWithUserPayload).mockResolvedValue({ createImage } as never);
      const transformImageForGeneration = vi.fn().mockResolvedValue({
        image: {
          extension: 'png',
          hash: 'hash-1',
          height: 4096,
          mime: 'image/png',
          size: 123,
          width: 4096,
        },
        thumbnailImage: { height: 512, mime: 'image/png', size: 12, width: 512 },
      });
      const uploadImageForGeneration = vi.fn().mockResolvedValue({
        imageUrl: 'files/generations/img.png',
        thumbnailImageUrl: 'files/generations/thumb.png',
      });
      const { GenerationService } = await import('@/server/services/generation');
      vi.mocked(GenerationService).mockImplementation(
        () => ({ transformImageForGeneration, uploadImageForGeneration }) as never,
      );
      const createFile = vi.fn().mockResolvedValue({ id: 'file-1' });
      const { FileModel } = await import('@/database/models/file');
      vi.mocked(FileModel).mockImplementation(() => ({ create: createFile }) as never);

      const caller = imageRouter.createCaller({
        jwtPayload: { apiKey: 'test-key' },
        secret: 'test-internal-secret',
        userId: 'test-user',
      });

      const result = await caller.createChatImage({
        model: 'gpt-image-2',
        params: { prompt: 'a rain-washed street' },
        provider: 'openaicompatible',
        taskId: 'task-2',
      });

      expect(result).toEqual({ success: true });
      // the image bytes are handled entirely server-side: transform → upload →
      // durable files row linked to the task via metadata.chatImageTaskId
      expect(transformImageForGeneration).toHaveBeenCalledWith(
        'data:image/png;base64,AAAA',
        undefined,
      );
      expect(uploadImageForGeneration).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ chatImageTaskId: 'task-2' }),
          url: 'files/generations/img.png',
        }),
        true,
      );
      expect(updateTask).toHaveBeenCalledWith('task-2', { status: 'success' });
    });

    it('forwards ComfyUI auth headers to the protected result download (R9-2)', async () => {
      mockClaimPendingTask.mockResolvedValue(true);
      const updateTask = vi.fn().mockResolvedValue(undefined);
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ claimPendingTask: mockClaimPendingTask, update: updateTask }) as never,
      );
      const authHeaders = { Authorization: 'Bearer comfy-token' };
      const createImage = vi
        .fn()
        .mockResolvedValue({ height: 1024, imageUrl: 'https://comfy/x.png', width: 1024 });
      vi.mocked(initModelRuntimeWithUserPayload).mockResolvedValue({
        createImage,
        getAuthHeaders: vi.fn(() => authHeaders),
      } as never);
      const transformImageForGeneration = vi.fn().mockResolvedValue({
        image: {
          extension: 'png',
          hash: 'h',
          height: 1024,
          mime: 'image/png',
          size: 1,
          width: 1024,
        },
        thumbnailImage: { height: 512, mime: 'image/png', size: 1, width: 512 },
      });
      const uploadImageForGeneration = vi
        .fn()
        .mockResolvedValue({ imageUrl: 'k/img.png', thumbnailImageUrl: 'k/t.png' });
      const { GenerationService } = await import('@/server/services/generation');
      vi.mocked(GenerationService).mockImplementation(
        () => ({ transformImageForGeneration, uploadImageForGeneration }) as never,
      );
      const { FileModel } = await import('@/database/models/file');
      vi.mocked(FileModel).mockImplementation(
        () => ({ create: vi.fn().mockResolvedValue({ id: 'f' }) }) as never,
      );

      const caller = imageRouter.createCaller({
        jwtPayload: { apiKey: 'test-key' },
        secret: 'test-internal-secret',
        userId: 'test-user',
      });

      await caller.createChatImage({
        model: 'comfy-model',
        params: { prompt: 'p' },
        provider: 'comfyui',
        taskId: 'task-4',
      });

      // protected ComfyUI result URLs require the runtime's auth headers
      expect(transformImageForGeneration).toHaveBeenCalledWith('https://comfy/x.png', authHeaders);
    });

    it('marks the task failed with a categorized error when the provider call rejects', async () => {
      mockClaimPendingTask.mockResolvedValue(true);
      const updateTask = vi.fn().mockResolvedValue(undefined);
      vi.mocked(AsyncTaskModel).mockImplementation(
        () => ({ claimPendingTask: mockClaimPendingTask, update: updateTask }) as never,
      );
      const createImage = vi.fn().mockRejectedValue(new Error('upstream 503'));
      vi.mocked(initModelRuntimeWithUserPayload).mockResolvedValue({ createImage } as never);

      const caller = imageRouter.createCaller({
        jwtPayload: { apiKey: 'test-key' },
        secret: 'test-internal-secret',
        userId: 'test-user',
      });

      const result = await caller.createChatImage({
        model: 'gpt-image-2',
        params: { prompt: 'p' },
        provider: 'openaicompatible',
        taskId: 'task-3',
      });

      expect(result).toEqual({ message: expect.stringContaining('upstream 503'), success: false });
      expect(updateTask).toHaveBeenCalledWith(
        'task-3',
        expect.objectContaining({ status: 'error' }),
      );
    });
  });
});
