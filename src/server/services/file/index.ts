import { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import urlJoin from 'url-join';

import { serverDBEnv } from '@/config/db';
import { FileModel } from '@/database/models/file';
import { FileItem } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { TempFileManager } from '@/server/utils/tempFileManager';
import { nanoid } from '@/utils/uuid';

import { FileServiceImpl, createFileServiceModule } from './impls';

/**
 * 文件服务类
 * 使用模块化实现方式，提供文件操作服务
 */
export class FileService {
  private userId: string;
  private fileModel: FileModel;

  private impl: FileServiceImpl = createFileServiceModule();

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.fileModel = new FileModel(db, userId);
  }

  /**
   * 删除文件
   */
  public async deleteFile(key: string) {
    return this.impl.deleteFile(key);
  }

  /**
   * 批量删除文件
   */
  public async deleteFiles(keys: string[]) {
    return this.impl.deleteFiles(keys);
  }

  /**
   * 获取文件内容
   */
  public async getFileContent(key: string): Promise<string> {
    return this.impl.getFileContent(key);
  }

  /**
   * 获取文件字节数组
   */
  public async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.impl.getFileByteArray(key);
  }

  /**
   * 创建预签名上传URL
   */
  public async createPreSignedUrl(key: string): Promise<string> {
    return this.impl.createPreSignedUrl(key);
  }

  /**
   * 创建预签名预览URL
   */
  public async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.impl.createPreSignedUrlForPreview(key, expiresIn);
  }

  /**
   * 上传内容
   */
  public async uploadContent(path: string, content: string) {
    return this.impl.uploadContent(path, content);
  }

  /**
   * 获取完整文件URL（用于AI模型访问，直接使用S3_PUBLIC_DOMAIN）
   */
  public async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    return this.impl.getFullFileUrl(url, expiresIn);
  }

  /**
   * 获取UI代理文件URL（用于浏览器显示，通过应用代理路由，需要登录）
   * Returns a URL routed through the app server (/webapi/files/[...key]),
   * so end-users only see the app domain. Falls back to getFullFileUrl when
   * APP_URL is not configured (e.g. desktop mode).
   */
  public async getUIFileUrl(url?: string | null): Promise<string> {
    if (!url) return '';
    const appUrl = appEnv.APP_URL;
    if (!appUrl) return this.getFullFileUrl(url);
    const key = this.getKeyFromFullUrl(url);
    return urlJoin(appUrl, 'webapi/files', key);
  }

  /**
   * 从完整 URL中 提取 key
   */
  public getKeyFromFullUrl(url: string): string {
    return this.impl.getKeyFromFullUrl(url);
  }

  /**
   * Whether a storage key belongs to this user. A files row stores the key either as the
   * bare key (normal rows) or as a legacy full storage URL that resolves to it. Used to gate
   * per-user access to the file proxy so a logged-in user can't read another user's objects.
   */
  public async isKeyOwnedByUser(key: string): Promise<boolean> {
    const candidates = await this.fileModel.findUrlCandidatesByKey(key);
    return candidates.some((url) => url === key || this.getKeyFromFullUrl(url) === key);
  }

  /**
   * 上传媒体文件
   */
  public async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    return this.impl.uploadMedia(key, buffer);
  }

  async downloadFileToLocal(
    fileId: string,
  ): Promise<{ cleanup: () => void; file: FileItem; filePath: string }> {
    const file = await this.fileModel.findById(fileId);
    if (!file) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
    }

    let content: Uint8Array | undefined;
    try {
      content = await this.getFileByteArray(file.url);
    } catch (e) {
      console.error(e);
      // if file not found, delete it from db
      if ((e as any).Code === 'NoSuchKey') {
        await this.fileModel.delete(fileId, serverDBEnv.REMOVE_GLOBAL_FILE);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }
    }

    if (!content) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File content is empty' });

    const dir = nanoid();
    const tempManager = new TempFileManager(dir);

    const filePath = await tempManager.writeTempFile(content, file.name);
    return { cleanup: () => tempManager.cleanup(), file, filePath };
  }
}
