/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const messageMocks = vi.hoisted(() => ({ query: vi.fn() }));
const fileModelMocks = vi.hoisted(() => ({
  checkHash: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
}));
const fileServiceMocks = vi.hoisted(() => ({
  getFileByteArray: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    query = messageMocks.query;
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    checkHash = fileModelMocks.checkHash;
    create = fileModelMocks.create;
    findById = fileModelMocks.findById;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileByteArray = fileServiceMocks.getFileByteArray;
    uploadMedia = fileServiceMocks.uploadMedia;
  },
}));
vi.mock('@/server/services/file/uploadTarget', () => ({
  createUploadTarget: vi.fn().mockReturnValue({ path: 'files/scope/1/out.bin' }),
}));
vi.mock('@/envs/codeInterpreter', () => ({
  codeInterpreterEnv: {
    CODE_INTERPRETER_MAX_FILE_BYTES: 10 * 1024 * 1024,
    CODE_INTERPRETER_MAX_FILE_COUNT: 20,
  },
}));

import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

import { gatherConversationSandboxFiles, persistSandboxOutputFiles } from '../files';

describe('Code Interpreter conversation files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageMocks.query.mockResolvedValue([]);
    fileModelMocks.findById.mockResolvedValue(undefined);
    fileModelMocks.checkHash.mockResolvedValue({ isExist: false });
    fileModelMocks.create.mockResolvedValue({ id: 'file-out' });
    fileServiceMocks.uploadMedia.mockResolvedValue({ key: 'files/scope/1/out.bin' });
  });

  it('skips a stale prior interpreter file and keeps a later one', async () => {
    messageMocks.query.mockResolvedValue([
      {
        content: JSON.stringify({
          files: [
            { fileId: 'stale', filename: 'a.txt' },
            { fileId: 'good', filename: 'b.txt' },
          ],
        }),
        plugin: { identifier: CodeInterpreterIdentifier },
        role: 'tool',
      },
    ]);
    fileModelMocks.findById
      .mockRejectedValueOnce(new Error('deleted'))
      .mockResolvedValueOnce({ name: 'b.txt', url: 'files/b.txt' });
    fileServiceMocks.getFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files.map((file) => file.filename)).toEqual(['b.txt']);
    expect(Buffer.from(files[0].contentBase64, 'base64')).toEqual(Buffer.from([1, 2, 3]));
  });

  it('persists sandbox outputs through the server file service', async () => {
    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [{ content: new Uint8Array([9, 9]), filename: 'plot_1.png' }],
      userId: 'user-1',
    });

    expect(fileServiceMocks.uploadMedia).toHaveBeenCalledWith(
      'files/scope/1/out.bin',
      Buffer.from([9, 9]),
    );
    expect(fileModelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plot_1.png',
        url: 'files/scope/1/out.bin',
      }),
      true,
    );
    expect(result).toEqual([{ fileId: 'file-out', filename: 'plot_1.png' }]);
  });
});
