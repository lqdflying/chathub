import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { messageService } from '@/services/message';
import { uploadService } from '@/services/upload';
import { ImportStage } from '@/types/importer';

import { ServerService } from './server';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    importer: {
      importByFile: { mutate: vi.fn() },
      importByPost: { mutate: vi.fn() },
      importPgByPost: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getConversationVersion: vi.fn(),
  },
}));

vi.mock('@/services/upload', () => ({
  uploadService: {
    uploadDataToS3: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: () => ({
      importAppSettings: vi.fn(),
    }),
  },
}));

describe('server import conversation version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(messageService.getConversationVersion).mockResolvedValue(7);
    vi.mocked(lambdaClient.importer.importByFile.mutate).mockResolvedValue({
      results: {},
      success: true,
    } as any);
  });

  it('captures the conversation version before uploading a large import', async () => {
    const largeImport = {
      messages: Array.from({ length: 500 }, (_, index) => ({
        content: `message-${index}`,
        id: `message-${index}`,
        role: 'user',
      })),
      version: 1,
    };

    vi.mocked(uploadService.uploadDataToS3).mockImplementation(async () => {
      expect(messageService.getConversationVersion).toHaveBeenCalledOnce();
      return {
        data: { path: 'import_config/large-import.json' },
        success: true,
      } as any;
    });

    await new ServerService().importData(largeImport as any);

    expect(lambdaClient.importer.importByFile.mutate).toHaveBeenCalledWith({
      expectedConversationVersion: 7,
      pathname: 'import_config/large-import.json',
    });
  });

  it('reports a JSON import version lookup failure through callbacks', async () => {
    const onError = vi.fn();
    const onStageChange = vi.fn();
    vi.mocked(messageService.getConversationVersion).mockRejectedValue(
      new Error('Version lookup failed'),
    );

    await new ServerService().importData(
      { messages: [], version: 1 } as any,
      { onError, onStageChange },
    );

    expect(onStageChange).toHaveBeenCalledWith(ImportStage.Error);
    expect(onError).toHaveBeenCalledWith({
      code: 'ImportError',
      httpStatus: 0,
      message: 'Version lookup failed',
    });
    expect(lambdaClient.importer.importByPost.mutate).not.toHaveBeenCalled();
  });

  it('reports a PostgreSQL import version lookup failure through callbacks', async () => {
    const onError = vi.fn();
    const onStageChange = vi.fn();
    vi.mocked(messageService.getConversationVersion).mockRejectedValue(
      new Error('Version lookup failed'),
    );

    await new ServerService().importPgData(
      {
        data: {},
        mode: 'pglite',
        schemaHash: 'hash',
      } as any,
      { callbacks: { onError, onStageChange } },
    );

    expect(onStageChange).toHaveBeenCalledWith(ImportStage.Error);
    expect(onError).toHaveBeenCalledWith({
      code: 'ImportError',
      httpStatus: 0,
      message: 'Version lookup failed',
    });
    expect(lambdaClient.importer.importPgByPost.mutate).not.toHaveBeenCalled();
  });
});
