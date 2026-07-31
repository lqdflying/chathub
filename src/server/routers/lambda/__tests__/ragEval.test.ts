import { describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { FileService } from '@/server/services/file';

import { ragEvalRouter } from '../ragEval';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findByNames: vi.fn() })),
}));

vi.mock('@/database/server/models/ragEval', () => ({
  EvalDatasetModel: vi.fn(() => ({})),
  EvalDatasetRecordModel: vi.fn(() => ({ batchCreate: vi.fn() })),
  EvalEvaluationModel: vi.fn(() => ({})),
  EvaluationRecordModel: vi.fn(() => ({})),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getXorPayload: vi.fn(() => ({})),
}));

describe('ragEvalRouter', () => {
  it('rejects a foreign import pathname before reading from storage', async () => {
    const getFileContent = vi.fn();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
    vi.mocked(FileService).mockImplementation(() => ({ getFileContent }) as never);

    const caller = ragEvalRouter.createCaller({
      authorizationHeader: 'test-authorization',
      userId: 'account-a',
    } as never);

    await expect(
      caller.importDatasetRecords({
        datasetId: 1,
        pathname: 'ragEval/foreign-account/1/dataset.jsonl',
      }),
    ).rejects.toThrow('invalid RAG import pathname');

    expect(getFileContent).not.toHaveBeenCalled();
  });
});
