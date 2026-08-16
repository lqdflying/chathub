import { parseDataUri } from '@lobechat/model-runtime';
import dayjs from 'dayjs';
import { sha256 } from 'js-sha256';

import { lambdaClient } from '@/libs/trpc/client';
import { createHeaderWithAuth } from '@/services/_auth';
import { API_ENDPOINTS } from '@/services/_url';
import { FileMetadata, UploadBase64ToS3Result } from '@/types/files';
import { FileUploadState, FileUploadStatus } from '@/types/files/upload';

export const UPLOAD_NETWORK_ERROR = 'NetWorkError';

interface UploadFileToS3Options {
  directory?: string;
  filename?: string;
  onProgress?: (status: FileUploadStatus, state: FileUploadState) => void;
  signal?: AbortSignal;
}

// The presign API rejects filenames over 255 chars (zod, lambda/edge upload
// routers). Names can come from unbounded sources — image prompts, files a
// Python program creates in the interpreter sandbox — so clamp the stem and
// keep the extension instead of letting the whole upload fail.
const MAX_UPLOAD_FILENAME_CHARS = 255;
const clampFileName = (name: string) => {
  if (name.length <= MAX_UPLOAD_FILENAME_CHARS) return name;
  const ext = /\.[^./\\]{1,31}$/.exec(name)?.[0] ?? '';
  return `${name.slice(0, MAX_UPLOAD_FILENAME_CHARS - ext.length)}${ext}`;
};

class UploadService {
  uploadFileToS3 = async (
    file: File,
    { onProgress, directory, signal }: UploadFileToS3Options,
  ): Promise<{ data: FileMetadata; success: boolean }> => {
    signal?.throwIfAborted();

    if (directory && directory !== 'ragEval') {
      throw new Error('Unsupported server upload directory');
    }

    const data = await this.uploadToServerS3(file, { directory, onProgress, signal });
    signal?.throwIfAborted();
    return { data, success: true };
  };

  uploadBase64ToS3 = async (
    base64Data: string,
    options: UploadFileToS3Options = {},
  ): Promise<UploadBase64ToS3Result> => {
    // 解析 base64 数据
    const { base64, mimeType, type } = parseDataUri(base64Data);

    if (!base64 || !mimeType || type !== 'base64') {
      throw new Error('Invalid base64 data for image');
    }

    // 将 base64 转换为 Blob
    const byteCharacters = atob(base64);
    const byteArrays = [];

    // 分块处理以避免内存问题
    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
      const slice = byteCharacters.slice(offset, offset + 1024);

      const byteNumbers: number[] = Array.from({ length: slice.length });
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: mimeType });

    // 确定文件扩展名
    const fileExtension = mimeType.split('/')[1] || 'png';
    const fileName = `${options.filename || `image_${dayjs().format('YYYY-MM-DD-hh-mm-ss')}`}.${fileExtension}`;

    // 创建文件对象
    const file = new File([blob], fileName, { type: mimeType });

    // 使用统一的上传方法
    const { data: metadata } = await this.uploadFileToS3(file, options);
    options.signal?.throwIfAborted();
    const hash = sha256(await file.arrayBuffer());

    return {
      fileType: mimeType,
      hash,
      metadata,
      size: file.size,
    };
  };

  uploadDataToS3 = async (data: object, options: UploadFileToS3Options = {}) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], options.filename || 'data.json', { type: 'application/json' });
    return await this.uploadFileToS3(file, options);
  };

  uploadToServerS3 = async (
    file: File,
    {
      onProgress,
      directory,
      signal,
    }: {
      directory?: 'ragEval';
      onProgress?: (status: FileUploadStatus, state: FileUploadState) => void;
      signal?: AbortSignal;
    },
  ): Promise<FileMetadata> => {
    signal?.throwIfAborted();
    const xhr = new XMLHttpRequest();

    const { metadata, preSignUrl } = await this.getSignedUploadUrl(file, {
      directory,
      signal,
    });
    signal?.throwIfAborted();
    let startTime = Date.now();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Number(((event.loaded / event.total) * 100).toFixed(1));

        const speedInByte = event.loaded / ((Date.now() - startTime) / 1000);

        onProgress?.('uploading', {
          // if the progress is 100, it means the file is uploaded
          // but the server is still processing it
          // so make it as 99.9 and let users think it's still uploading
          progress: progress === 100 ? 99.9 : progress,
          restTime: (event.total - event.loaded) / speedInByte,
          speed: speedInByte,
        });
      }
    });

    xhr.open('PUT', preSignUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    const data = await file.arrayBuffer();
    signal?.throwIfAborted();

    await new Promise((resolve, reject) => {
      const handleAbort = () => {
        xhr.abort();
        reject(signal?.reason);
      };
      xhr.addEventListener('load', () => {
        signal?.removeEventListener('abort', handleAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.('success', {
            progress: 100,
            restTime: 0,
            speed: file.size / ((Date.now() - startTime) / 1000),
          });
          resolve(xhr.response);
        } else {
          reject(xhr.statusText);
        }
      });
      xhr.addEventListener('error', () => {
        signal?.removeEventListener('abort', handleAbort);
        if (xhr.status === 0) reject(UPLOAD_NETWORK_ERROR);
        else reject(xhr.statusText);
      });
      signal?.addEventListener('abort', handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      xhr.send(data);
    });

    return metadata;
  };

  /**
   * get image File item with cors image URL
   * @param url
   * @param filename
   * @param fileType
   */
  getImageFileByUrlWithCORS = async (url: string, filename: string, fileType?: string) => {
    const headers = await createHeaderWithAuth();
    const res = await fetch(API_ENDPOINTS.proxy, { body: url, headers, method: 'POST' });

    // A non-OK proxy response returns error HTML/JSON bytes; without this guard
    // they'd be wrapped as an image and uploaded as a corrupt file.
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Failed to fetch image (${res.status}): ${detail.slice(0, 200)}`);
    }

    const data = await res.arrayBuffer();

    // Classify by the ACTUAL bytes, never a spoofable/absent content-type: a
    // provider/CDN error page (or a malicious remote) can send an `image/*`
    // header over an HTML/JSON body, and that must not be persisted as an image.
    // `file-type` is already a dependency (see store/file upload action).
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(new Uint8Array(data));
    if (!detected || !detected.mime.startsWith('image/')) {
      throw new Error(
        `Proxied response is not a supported image (detected: ${detected?.mime ?? 'unknown'})`,
      );
    }

    // an explicit caller type may only confirm the verified bytes — it can never
    // bypass verification, so a mismatch is rejected
    if (fileType && fileType !== detected.mime) {
      throw new Error(
        `Requested image type ${fileType} does not match the fetched bytes (${detected.mime})`,
      );
    }

    // derive both MIME and extension from the verified result
    const finalName = `${filename.replace(/\.[^./\\]+$/, '')}.${detected.ext}`;
    return new File([data], finalName, { lastModified: Date.now(), type: detected.mime });
  };

  private getSignedUploadUrl = async (
    file: File,
    options: { directory?: 'ragEval'; signal?: AbortSignal } = {},
  ): Promise<{ metadata: FileMetadata; preSignUrl: string }> => {
    return lambdaClient.upload.createS3PreSignedUrl.mutate(
      {
        filename: clampFileName(file.name),
        purpose: options.directory === 'ragEval' ? 'ragEval' : 'file',
      },
      { signal: options.signal },
    );
  };
}

export const uploadService = new UploadService();
