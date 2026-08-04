import urlJoin from 'url-join';

import { fileEnv } from '@/envs/file';
import { S3 } from '@/server/modules/S3';

import { FileServiceImpl } from './type';
import { extractKeyFromUrlOrReturnOriginal } from './utils';

/**
 * 基于S3的文件服务实现
 */
export class S3StaticFileImpl implements FileServiceImpl {
  private readonly s3: S3;

  constructor() {
    this.s3 = new S3();
  }

  private normalizeKey(key: string): string {
    return extractKeyFromUrlOrReturnOriginal(key, this.getKeyFromFullUrl.bind(this));
  }

  async deleteFile(key: string) {
    return this.s3.deleteFile(this.normalizeKey(key));
  }

  async deleteFiles(keys: string[]) {
    return this.s3.deleteFiles(keys.map((key) => this.normalizeKey(key)));
  }

  async getFileContent(key: string): Promise<string> {
    return this.s3.getFileContent(this.normalizeKey(key));
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.s3.getFileByteArray(this.normalizeKey(key));
  }

  async hasFile(key: string): Promise<boolean> {
    return this.s3.hasFile(this.normalizeKey(key));
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.s3.createPreSignedUrl(key);
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.s3.createPreSignedUrlForPreview(key, expiresIn);
  }

  async uploadContent(path: string, content: string) {
    return this.s3.uploadContent(path, content);
  }

  async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    if (!url) return '';

    // Handle legacy data compatibility using shared utility
    const key = this.normalizeKey(url);

    // If S3_PUBLIC_DOMAIN is set, always use it to construct the URL.
    // This supports setups where the bucket is served via a custom domain
    // (e.g. Cloudflare R2 custom domain) without per-object ACLs.
    if (fileEnv.S3_PUBLIC_DOMAIN) {
      if (fileEnv.S3_ENABLE_PATH_STYLE) {
        return urlJoin(fileEnv.S3_PUBLIC_DOMAIN, fileEnv.S3_BUCKET!, key);
      }
      return urlJoin(fileEnv.S3_PUBLIC_DOMAIN, key);
    }

    // If bucket is not set public read, the preview address needs to be regenerated each time
    if (!fileEnv.S3_SET_ACL) {
      return await this.createPreSignedUrlForPreview(key, expiresIn);
    }

    return urlJoin(fileEnv.S3_ENDPOINT!, fileEnv.S3_BUCKET!, key);
  }

  getKeyFromFullUrl(url: string): string {
    try {
      const urlObject = new URL(url);
      const { pathname } = urlObject;

      let key: string;

      if (fileEnv.S3_ENABLE_PATH_STYLE) {
        if (!fileEnv.S3_BUCKET) {
          // In path-style, we need bucket name to extract key
          // but if not provided, we can only guess the key is the pathname
          return pathname.startsWith('/') ? pathname.slice(1) : pathname;
        }
        // For path-style URLs, the path is /<bucket>/<key>
        // We need to remove the leading slash and the bucket name.
        const bucketPrefix = `/${fileEnv.S3_BUCKET}/`;
        if (pathname.startsWith(bucketPrefix)) {
          key = pathname.slice(bucketPrefix.length);
        } else {
          // Fallback for unexpected path format
          key = pathname.startsWith('/') ? pathname.slice(1) : pathname;
        }
      } else {
        // For virtual-hosted-style URLs, the path is /<key>
        // We just need to remove the leading slash.
        key = pathname.slice(1);
      }

      return key;
    } catch {
      // if url is not a valid URL, it may be a key itself
      return url;
    }
  }

  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    await this.s3.uploadMedia(key, buffer);
    return { key };
  }
}
