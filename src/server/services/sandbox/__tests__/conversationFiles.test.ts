/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const messageMocks = vi.hoisted(() => ({ query: vi.fn() }));
const threadMocks = vi.hoisted(() => ({ findById: vi.fn() }));
const fileModelMocks = vi.hoisted(() => ({
  checkHash: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
}));
const fileEnvMock = vi.hoisted(() => ({
  S3_PUBLIC_DOMAIN: undefined as string | undefined,
  S3_SET_ACL: false,
}));
const fileServiceMocks = vi.hoisted(() => ({
  getFileByteArray: vi.fn(),
  getFullFileUrl: vi.fn(),
  getUIFileUrl: vi.fn(),
  uploadBytes: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    query = messageMocks.query;
  },
}));
vi.mock('@/database/models/thread', () => ({
  ThreadModel: class {
    findById = threadMocks.findById;
  },
}));
vi.mock('@/database/models/file', () => ({
  FileModel: class {
    checkHash = fileModelMocks.checkHash;
    create = fileModelMocks.create;
    findById = fileModelMocks.findById;
  },
}));
vi.mock('@/envs/file', () => ({
  fileEnv: fileEnvMock,
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileByteArray = fileServiceMocks.getFileByteArray;
    getFullFileUrl = fileServiceMocks.getFullFileUrl;
    getUIFileUrl = fileServiceMocks.getUIFileUrl;
    uploadBytes = fileServiceMocks.uploadBytes;
  },
}));
vi.mock('@/server/services/file/uploadTarget', () => ({
  createUploadTarget: vi.fn().mockReturnValue({ path: 'files/scope/1/out.bin' }),
}));
vi.mock('@/envs/codeInterpreter', () => ({
  codeInterpreterEnv: {
    get CODE_INTERPRETER_MAX_FILE_BYTES() {
      return Number(process.env.CODE_INTERPRETER_MAX_FILE_BYTES ?? 10 * 1024 * 1024);
    },
    get CODE_INTERPRETER_MAX_FILE_COUNT() {
      return Number(process.env.CODE_INTERPRETER_MAX_FILE_COUNT ?? 20);
    },
  },
}));

import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

import {
  SANDBOX_GATHER_PAGE_SIZE,
  gatherConversationSandboxFiles,
  persistSandboxOutputFiles,
} from '../conversationFiles';

const bytesFor = (id: string) => new Uint8Array(Buffer.from(id));

describe('sandbox conversation files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CODE_INTERPRETER_MAX_FILE_COUNT;
    fileEnvMock.S3_PUBLIC_DOMAIN = undefined;
    fileEnvMock.S3_SET_ACL = false;
    messageMocks.query.mockResolvedValue([]);
    threadMocks.findById.mockResolvedValue(undefined);
    fileModelMocks.findById.mockImplementation(async (id: string) => ({
      name: `${id}.txt`,
      url: `files/${id}`,
    }));
    fileModelMocks.checkHash.mockResolvedValue({ isExist: false });
    fileModelMocks.create.mockResolvedValue({ id: 'file-out' });
    fileServiceMocks.getFileByteArray.mockImplementation(async (url: string) =>
      bytesFor(String(url).replace('files/', '')),
    );
    fileServiceMocks.uploadBytes.mockResolvedValue({ key: 'files/scope/1/out.bin' });
    fileServiceMocks.getFullFileUrl.mockImplementation(
      async (key: string) => `https://cdn.example/${key}`,
    );
    fileServiceMocks.getUIFileUrl.mockImplementation(
      async (key: string) => `https://app.example/webapi/files/${key}`,
    );
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
    expect(Buffer.from(files[0].content)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('keeps main-topic files and excludes portal-thread files', async () => {
    messageMocks.query.mockResolvedValue([
      {
        fileList: [{ id: 'portal-file', name: 'portal.txt' }],
        id: 'thread-a-1',
        role: 'user',
        threadId: 'thread-a',
      },
      { fileList: [{ id: 'main-file', name: 'main.txt' }], id: 'main-1', role: 'user' },
    ]);

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files.map((file) => file.filename)).toEqual(['main-file.txt']);
  });

  it('gathers only the visible portal thread, not a sibling thread', async () => {
    threadMocks.findById.mockResolvedValue({
      id: 'thread-a',
      sourceMessageId: 'main-2',
    });
    messageMocks.query.mockResolvedValue([
      {
        fileList: [{ id: 'other-file', name: 'other.txt' }],
        id: 'thread-b-1',
        role: 'user',
        threadId: 'thread-b',
      },
      {
        fileList: [{ id: 'portal-file', name: 'portal.txt' }],
        id: 'thread-a-1',
        role: 'user',
        threadId: 'thread-a',
      },
      { id: 'main-2', role: 'user' },
      { fileList: [{ id: 'main-file', name: 'main.txt' }], id: 'main-1', role: 'user' },
    ]);

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      threadId: 'thread-a',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files.map((file) => file.filename).sort()).toEqual(['main-file.txt', 'portal-file.txt']);
  });

  it('queries newest-first and gathers a file on the newest page', async () => {
    messageMocks.query.mockImplementation(async ({ current, order, pageSize }) => {
      expect(order).toBe('desc');
      if (current === 0) {
        return [
          {
            fileList: [{ id: 'needed', name: 'needed.txt' }],
            id: 'new-201',
            role: 'user',
          },
          ...Array.from({ length: pageSize - 1 }, (_, index) => ({
            id: `older-${index}`,
            role: 'user',
          })),
        ];
      }
      throw new Error(`unexpected extra page ${current}`);
    });
    process.env.CODE_INTERPRETER_MAX_FILE_COUNT = '1';

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(messageMocks.query.mock.calls[0][0]).toMatchObject({
      current: 0,
      order: 'desc',
      pageSize: SANDBOX_GATHER_PAGE_SIZE,
    });
    expect(messageMocks.query).toHaveBeenCalledTimes(1);
    expect(files.map((file) => file.filename)).toEqual(['needed.txt']);
  });

  it('gathers a file on message 201 instead of only the oldest 200', async () => {
    messageMocks.query.mockResolvedValue([
      {
        fileList: [{ id: 'late', name: 'late.txt' }],
        id: 'm-201',
        role: 'user',
      },
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `old-${index}`,
        role: 'user' as const,
      })),
    ]);

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files.map((file) => file.filename)).toEqual(['late.txt']);
  });

  it('prefers newer attachments when over the file-count cap', async () => {
    process.env.CODE_INTERPRETER_MAX_FILE_COUNT = '2';
    messageMocks.query.mockResolvedValue([
      { fileList: [{ id: 'new', name: 'new.txt' }], id: 'm3', role: 'user' },
      { fileList: [{ id: 'mid', name: 'mid.txt' }], id: 'm2', role: 'user' },
      { fileList: [{ id: 'old', name: 'old.txt' }], id: 'm1', role: 'user' },
    ]);

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files.map((file) => file.filename)).toEqual(['new.txt', 'mid.txt']);
  });

  it('keeps the newest file when two ids share a basename', async () => {
    messageMocks.query.mockResolvedValue([
      { fileList: [{ id: 'newer', name: 'report.csv' }], id: 'm-new', role: 'user' },
      { fileList: [{ id: 'older', name: 'report.csv' }], id: 'm-old', role: 'user' },
    ]);
    fileModelMocks.findById.mockImplementation(async (id: string) => ({
      name: 'report.csv',
      url: `files/${id}`,
    }));

    const files = await gatherConversationSandboxFiles({
      db: {} as any,
      sessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('report.csv');
    expect(Buffer.from(files[0].content).toString()).toBe('newer');
    expect(fileModelMocks.findById).not.toHaveBeenCalledWith('older');
  });

  it('persists sandbox outputs through the server file service', async () => {
    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [{ content: new Uint8Array([9, 9]), filename: 'plot_1.png' }],
      userId: 'user-1',
    });

    expect(fileServiceMocks.uploadBytes).toHaveBeenCalledWith(
      'files/scope/1/out.bin',
      Buffer.from([9, 9]),
      'image/png',
    );
    expect(fileServiceMocks.getFullFileUrl).not.toHaveBeenCalled();
    expect(fileModelMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plot_1.png',
        url: 'files/scope/1/out.bin',
      }),
      true,
    );
    expect(fileServiceMocks.getUIFileUrl).toHaveBeenCalledWith('files/scope/1/out.bin');
    expect(result).toEqual([
      {
        fileId: 'file-out',
        filename: 'plot_1.png',
        url: 'https://app.example/webapi/files/files/scope/1/out.bin',
      },
    ]);
  });

  it('skips a failed persist without aborting the rest of the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fileServiceMocks.uploadBytes
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce({ key: 'files/scope/1/out.bin' });

    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [
        { content: new Uint8Array([1]), filename: 'a.png' },
        { content: new Uint8Array([2]), filename: 'b.png' },
      ],
      userId: 'user-1',
    });

    expect(result).toEqual([
      {
        fileId: 'file-out',
        filename: 'b.png',
        url: 'https://app.example/webapi/files/files/scope/1/out.bin',
      },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stores a PDF with application/pdf and a public open URL', async () => {
    fileEnvMock.S3_PUBLIC_DOMAIN = 'https://cdn.example';

    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [{ content: new Uint8Array([37, 80, 68, 70]), filename: 'jiaozi-su-xian.pdf' }],
      userId: 'user-1',
    });

    expect(fileServiceMocks.uploadBytes).toHaveBeenCalledWith(
      'files/scope/1/out.bin',
      Buffer.from([37, 80, 68, 70]),
      'application/pdf',
    );
    expect(fileServiceMocks.getFullFileUrl).toHaveBeenCalledWith('files/scope/1/out.bin');
    expect(fileServiceMocks.getUIFileUrl).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        fileId: 'file-out',
        filename: 'jiaozi-su-xian.pdf',
        url: 'https://cdn.example/files/scope/1/out.bin',
      },
    ]);
  });

  it('uses the public object URL when the bucket ACL is public', async () => {
    fileEnvMock.S3_SET_ACL = true;

    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [{ content: new Uint8Array([1]), filename: 'notes.docx' }],
      userId: 'user-1',
    });

    expect(fileServiceMocks.getFullFileUrl).toHaveBeenCalledWith('files/scope/1/out.bin');
    expect(result[0]?.url).toBe('https://cdn.example/files/scope/1/out.bin');
  });

  it('falls back to the file proxy when the public URL cannot be resolved', async () => {
    fileEnvMock.S3_PUBLIC_DOMAIN = 'https://cdn.example';
    fileServiceMocks.getFullFileUrl.mockRejectedValueOnce(new Error('presign failed'));

    const result = await persistSandboxOutputFiles({
      db: {} as any,
      files: [{ content: new Uint8Array([1]), filename: 'jiaozi-su-xian.pdf' }],
      userId: 'user-1',
    });

    expect(result[0]?.url).toBe('https://app.example/webapi/files/files/scope/1/out.bin');
  });
});
