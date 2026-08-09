// @vitest-environment node
import { LobeChatDatabase } from '@lobechat/database';
import { loadFile } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';

import { DocumentService } from '.';
import { FileService } from '../file';

vi.mock('@lobechat/file-loaders', () => ({
  loadFile: vi.fn(),
}));
vi.mock('@/database/models/document');
vi.mock('@/database/models/file');
vi.mock('../file', () => ({
  FileService: vi.fn(),
}));

describe('DocumentService', () => {
  const database = {} as LobeChatDatabase;
  const cleanup = vi.fn();
  const createDocument = vi.fn();
  const downloadFileToLocal = vi.fn();
  const findFileById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(DocumentModel).mockImplementation(
      () =>
        ({
          create: createDocument,
        }) as unknown as DocumentModel,
    );
    vi.mocked(FileModel).mockImplementation(
      () =>
        ({
          findById: findFileById,
        }) as unknown as FileModel,
    );
    vi.mocked(FileService).mockImplementation(
      () =>
        ({
          downloadFileToLocal,
        }) as unknown as FileService,
    );
  });

  it('sanitizes document text and nested metadata before persistence', async () => {
    const persistedDocument = { id: 'document-id' };
    const createdTime = new Date('2026-08-08T00:00:00Z');
    findFileById.mockResolvedValue({
      fileType: 'application/pdf',
      name: 'report.pdf',
      url: 'files/test-user/report.pdf',
    });
    downloadFileToLocal.mockResolvedValue({
      cleanup,
      filePath: '/tmp/report.pdf',
    });
    vi.mocked(loadFile).mockResolvedValue({
      content: 'Main\u0000 content 😀',
      createdTime,
      fileType: 'pdf',
      filename: 'report.pdf',
      metadata: {
        'bad\u0000key': 'clean\u0000value',
        'nested': [{ loneSurrogate: '\uD800' }],
        'title': 'Quarterly\u0000 report 😀',
      },
      modifiedTime: createdTime,
      pages: [
        {
          charCount: 17,
          lineCount: 1,
          metadata: {
            'page\u0000key': 'Section\u0000 one 😀',
          },
          pageContent: 'Page\u0000 content 😀',
        },
      ],
      source: '/tmp/report.pdf',
      totalCharCount: 17,
      totalLineCount: 1,
    });
    createDocument.mockResolvedValue(persistedDocument);

    const service = new DocumentService(database, 'test-user');

    await expect(service.parseFile('file-id')).resolves.toBe(persistedDocument);
    expect(createDocument).toHaveBeenCalledWith({
      content: 'Main content 😀',
      fileId: 'file-id',
      fileType: 'application/pdf',
      metadata: {
        badkey: 'cleanvalue',
        nested: [{ loneSurrogate: '' }],
        title: 'Quarterly report 😀',
      },
      pages: [
        {
          charCount: 17,
          lineCount: 1,
          metadata: {
            pagekey: 'Section one 😀',
          },
          pageContent: 'Page content 😀',
        },
      ],
      source: 'files/test-user/report.pdf',
      sourceType: 'file',
      title: 'Quarterly report 😀',
      totalCharCount: 17,
      totalLineCount: 1,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('returns BAD_REQUEST before downloading an unsupported attachment', async () => {
    findFileById.mockResolvedValue({
      fileType: 'image/png',
      name: 'screenshot.png',
      url: 'files/test-user/screenshot.png',
    });

    const service = new DocumentService(database, 'test-user');
    const result = service.parseFile('image-file');

    await expect(result).rejects.toMatchObject<TRPCError>({
      code: 'BAD_REQUEST',
      message: "File type 'image/png' is not supported by the built-in document parser",
    });
    expect(downloadFileToLocal).not.toHaveBeenCalled();
    expect(loadFile).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });
});
