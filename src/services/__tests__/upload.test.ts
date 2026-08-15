import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { createHeaderWithAuth } from '@/services/_auth';
import { API_ENDPOINTS } from '@/services/_url';

import { UPLOAD_NETWORK_ERROR, uploadService } from '../upload';

vi.mock('@lobechat/model-runtime', () => ({
  parseDataUri: vi.fn(),
}));

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({
    'X-lobe-chat-auth': 'encrypted-payload',
  })),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    upload: {
      createS3PreSignedUrl: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('js-sha256', () => ({
  sha256: vi.fn((data) => 'mock-hash-' + data.byteLength),
}));

describe('UploadService', () => {
  const mockFile = new File(['test'], 'test.png', { type: 'image/png' });
  const mockPreSignUrl = 'https://example.com/presign';
  const mockServerMetadata = {
    date: '1',
    dirname: 'files/account-scope/1',
    filename: 'server-upload.png',
    path: 'files/account-scope/1/server-upload.png',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // Mock Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => 3_600_000); // 1 hour in milliseconds
  });

  describe('uploadFileToS3', () => {
    it('should upload through the server object store', async () => {
      vi.spyOn(uploadService, 'uploadToServerS3').mockResolvedValue(mockServerMetadata);

      const result = await uploadService.uploadFileToS3(mockFile, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockServerMetadata);
      expect(uploadService.uploadToServerS3).toHaveBeenCalledWith(mockFile, {
        directory: undefined,
        onProgress: undefined,
        signal: undefined,
      });
    });

    it('should reject obsolete client upload directories', async () => {
      await expect(
        uploadService.uploadFileToS3(mockFile, { directory: 'legacy-local' }),
      ).rejects.toThrow('Unsupported server upload directory');
    });
  });

  describe('uploadBase64ToS3', () => {
    it('should upload base64 data successfully', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'dGVzdA==', // "test" in base64
        mimeType: 'image/png',
        type: 'base64',
      });

      const { sha256 } = await import('js-sha256');
      vi.mocked(sha256).mockReturnValue('base64-hash');
      vi.spyOn(uploadService, 'uploadToServerS3').mockResolvedValue(mockServerMetadata);

      const base64Data = 'data:image/png;base64,dGVzdA==';
      const result = await uploadService.uploadBase64ToS3(base64Data);

      expect(result).toMatchObject({
        fileType: 'image/png',
        hash: expect.any(String),
        metadata: mockServerMetadata,
        size: expect.any(Number),
      });
    });

    it('should throw error for invalid base64 data', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: null,
        mimeType: null,
        type: 'url',
      });

      const invalidBase64 = 'not-a-base64-string';

      await expect(uploadService.uploadBase64ToS3(invalidBase64)).rejects.toThrow(
        'Invalid base64 data for image',
      );
    });

    it('should use custom filename when provided', async () => {
      const { parseDataUri } = await import('@lobechat/model-runtime');
      vi.mocked(parseDataUri).mockReturnValueOnce({
        base64: 'dGVzdA==',
        mimeType: 'image/png',
        type: 'base64',
      });

      const { sha256 } = await import('js-sha256');
      vi.mocked(sha256).mockReturnValue('custom-hash');
      const upload = vi
        .spyOn(uploadService, 'uploadToServerS3')
        .mockResolvedValue(mockServerMetadata);

      const base64Data = 'data:image/png;base64,dGVzdA==';
      await uploadService.uploadBase64ToS3(base64Data, {
        filename: 'custom-image',
      });

      expect(upload.mock.calls[0][0].name).toBe('custom-image.png');
    });
  });

  describe('uploadDataToS3', () => {
    it('should upload JSON data successfully', async () => {
      const { sha256 } = await import('js-sha256');
      vi.mocked(sha256).mockReturnValue('json-hash');
      vi.spyOn(uploadService, 'uploadToServerS3').mockResolvedValue(mockServerMetadata);

      const data = { key: 'value', number: 123 };
      const result = await uploadService.uploadDataToS3(data);

      expect(result.success).toBe(true);
      expect(uploadService.uploadToServerS3).toHaveBeenCalled();
    });

    it('should use custom filename when provided', async () => {
      const { sha256 } = await import('js-sha256');
      vi.mocked(sha256).mockReturnValue('custom-json-hash');
      vi.spyOn(uploadService, 'uploadToServerS3').mockResolvedValue({
        ...mockServerMetadata,
        filename: 'custom.json',
      });

      const data = { test: true };
      const result = await uploadService.uploadDataToS3(data, {
        filename: 'custom.json',
      });

      expect(result.success).toBe(true);
      expect(result.data.filename).toBe('custom.json');
    });
  });

  describe('uploadToServerS3', () => {
    beforeEach(() => {
      // Mock XMLHttpRequest
      const xhrMock = {
        addEventListener: vi.fn(),
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        status: 200,
        upload: {
          addEventListener: vi.fn(),
        },
      };
      global.XMLHttpRequest = vi.fn(() => xhrMock) as any;

      // Mock createS3PreSignedUrl
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValue({
        metadata: mockServerMetadata,
        preSignUrl: mockPreSignUrl,
      });
    });

    it('should upload file successfully with progress', async () => {
      const onProgress = vi.fn();
      const xhr = new XMLHttpRequest();

      // Simulate successful upload
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      const result = await uploadService.uploadToServerS3(mockFile, { onProgress });

      expect(result).toEqual(mockServerMetadata);
      expect(lambdaClient.upload.createS3PreSignedUrl.mutate).toHaveBeenCalledWith(
        { filename: 'test.png', purpose: 'file' },
        { signal: undefined },
      );
    });

    it('should report progress during upload', async () => {
      const onProgress = vi.fn();
      const xhr = new XMLHttpRequest();

      // Simulate progress events
      vi.spyOn(xhr.upload, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'progress') {
          // @ts-expect-error - mock implementation
          handler({
            lengthComputable: true,
            loaded: 500,
            total: 1000,
          });
        }
      });

      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      await uploadService.uploadToServerS3(mockFile, { onProgress });

      expect(onProgress).toHaveBeenCalledWith(
        'uploading',
        expect.objectContaining({
          progress: expect.any(Number),
          restTime: expect.any(Number),
          speed: expect.any(Number),
        }),
      );
    });

    it('should handle network error', async () => {
      const xhr = new XMLHttpRequest();

      // Simulate network error
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'error') {
          Object.assign(xhr, { status: 0 });
          // @ts-expect-error - mock implementation
          handler({});
        }
      });

      await expect(uploadService.uploadToServerS3(mockFile, {})).rejects.toBe(UPLOAD_NETWORK_ERROR);
    });

    it('should handle upload error', async () => {
      const xhr = new XMLHttpRequest();

      // Simulate upload error
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          Object.assign(xhr, { status: 400, statusText: 'Bad Request' });

          // @ts-expect-error - mock implementation
          handler({});
        }
      });

      await expect(uploadService.uploadToServerS3(mockFile, {})).rejects.toBe('Bad Request');
    });

    it('should request the RAG upload purpose when provided', async () => {
      const xhr = new XMLHttpRequest();
      vi.spyOn(xhr, 'addEventListener').mockImplementation((event, handler) => {
        if (event === 'load') {
          // @ts-expect-error - mock implementation
          handler({ target: { status: 200 } });
        }
      });

      const ragMetadata = {
        date: '1',
        dirname: 'ragEval/account-scope/1',
        filename: 'dataset.jsonl',
        path: 'ragEval/account-scope/1/dataset.jsonl',
      };
      vi.mocked(lambdaClient.upload.createS3PreSignedUrl.mutate).mockResolvedValueOnce({
        metadata: ragMetadata,
        preSignUrl: mockPreSignUrl,
      });

      const result = await uploadService.uploadToServerS3(mockFile, {
        directory: 'ragEval',
      });

      expect(result).toEqual(ragMetadata);
      expect(lambdaClient.upload.createS3PreSignedUrl.mutate).toHaveBeenCalledWith(
        { filename: 'test.png', purpose: 'ragEval' },
        { signal: undefined },
      );
    });
  });

  describe('getImageFileByUrlWithCORS', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).buffer;
    const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      .buffer;
    const mockOk = (body: ArrayBuffer, contentType?: string) =>
      ({
        arrayBuffer: () => Promise.resolve(body),
        headers: { get: (k: string) => (k === 'content-type' ? (contentType ?? null) : null) },
        ok: true,
      }) as unknown as Response;

    it('sniffs PNG bytes and creates a file', async () => {
      vi.mocked(global.fetch).mockResolvedValue(mockOk(PNG));

      const result = await uploadService.getImageFileByUrlWithCORS(
        'https://example.com/image.png',
        'test.png',
      );

      expect(global.fetch).toHaveBeenCalledWith(API_ENDPOINTS.proxy, {
        body: 'https://example.com/image.png',
        headers: { 'X-lobe-chat-auth': 'encrypted-payload' },
        method: 'POST',
      });
      expect(result).toBeInstanceOf(File);
      expect(result.name).toBe('test.png');
      expect(result.type).toBe('image/png');
    });

    it('sniffs JPEG/WebP bytes and matches File.type + File.name to the format', async () => {
      vi.mocked(global.fetch).mockResolvedValue(mockOk(JPEG));
      const jpg = await uploadService.getImageFileByUrlWithCORS('https://x/y', 'y.png');
      expect(jpg.type).toBe('image/jpeg');
      expect(jpg.name).toBe('y.jpg');

      vi.mocked(global.fetch).mockResolvedValue(mockOk(WEBP));
      const webp = await uploadService.getImageFileByUrlWithCORS('https://x/z', 'z.png');
      expect(webp.type).toBe('image/webp');
      expect(webp.name).toBe('z.webp');
    });

    it('honors an explicit caller file type', async () => {
      vi.mocked(global.fetch).mockResolvedValue(mockOk(JPEG));
      const result = await uploadService.getImageFileByUrlWithCORS(
        'https://example.com/image.jpg',
        'test.jpg',
        'image/jpeg',
      );
      expect(result.type).toBe('image/jpeg');
    });

    it('falls back to the proxied image content-type when bytes are unrecognized', async () => {
      vi.mocked(global.fetch).mockResolvedValue(mockOk(new ArrayBuffer(8), 'image/webp'));
      const result = await uploadService.getImageFileByUrlWithCORS('https://x/y', 'y');
      expect(result.type).toBe('image/webp');
    });

    it('rejects a 200 non-image (HTML) response so no corrupt file is uploaded (finding B)', async () => {
      const html = new TextEncoder().encode('<html><body>error</body></html>').buffer;
      vi.mocked(global.fetch).mockResolvedValue(mockOk(html, 'text/html'));

      await expect(
        uploadService.getImageFileByUrlWithCORS('https://example.com/x.png', 'x.png'),
      ).rejects.toThrow('not a supported image');
    });

    it('throws on a non-OK proxy response so no corrupt file is uploaded', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('not found'),
      } as Response);

      await expect(
        uploadService.getImageFileByUrlWithCORS('https://example.com/x.png', 'x.png'),
      ).rejects.toThrow('Failed to fetch image (404)');
    });
  });
});
