import { LobeChatDatabase } from '@lobechat/database';
import { loadFile } from '@lobechat/file-loaders';
import { isDocumentParseableFile } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { LobeDocument } from '@/types/document';
import { sanitizeUTF8, sanitizeUTF8Deep } from '@/utils/sanitizeUTF8';

import { FileService } from '../file';

const log = debug('lobe-chat:service:document');

export class DocumentService {
  userId: string;
  private fileModel: FileModel;
  private documentModel: DocumentModel;
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.fileModel = new FileModel(db, userId);
    this.fileService = new FileService(db, userId);
    this.documentModel = new DocumentModel(db, userId);
  }

  /**
   * 解析文件内容
   *
   */
  async parseFile(fileId: string): Promise<LobeDocument> {
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
    }
    if (!isDocumentParseableFile(file.name, file.fileType)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `File type '${file.fileType}' is not supported by the built-in document parser`,
      });
    }

    const { filePath, cleanup } = await this.fileService.downloadFileToLocal(fileId);

    const logPrefix = `[${file.name}]`;
    log('[document:parseFile] 开始解析文件, 路径: %s %s', logPrefix, filePath);

    try {
      // 使用loadFile加载文件内容
      const fileDocument = await loadFile(filePath);

      log('[document:parseFile] 文件解析成功 %s %O', logPrefix, {
        fileType: fileDocument.fileType,
        size: fileDocument.content.length,
      });

      const sanitizedMetadata = sanitizeUTF8Deep(fileDocument.metadata);
      const sanitizedPages = fileDocument.pages?.map((page) => ({
        ...page,
        metadata: sanitizeUTF8Deep(page.metadata),
        pageContent: sanitizeUTF8(page.pageContent),
      }));

      const document = await this.documentModel.create({
        content: sanitizeUTF8(fileDocument.content),
        fileId,
        fileType: file.fileType,
        metadata: sanitizedMetadata,
        pages: sanitizedPages,
        source: file.url,
        sourceType: 'file',
        title: sanitizedMetadata.title,
        totalCharCount: fileDocument.totalCharCount,
        totalLineCount: fileDocument.totalLineCount,
      });

      return document as LobeDocument;
    } catch (error) {
      console.error('[document:parseFile] 文件解析失败:', logPrefix, error);
      throw error;
    } finally {
      cleanup();
    }
  }
}
