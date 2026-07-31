import { sha256 } from 'js-sha256';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUploadTarget, isUserUploadKey } from './uploadTarget';

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

vi.mock('@/utils/uuid', () => ({
  nanoid: () => 'upload-id',
}));

describe('uploadTarget', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(3_600_000);
  });

  it('creates a user-scoped file target that another user cannot claim', () => {
    const metadata = createUploadTarget({
      filename: 'Photo.PNG',
      purpose: 'file',
      userId: 'account-a',
    });

    expect(metadata).toEqual({
      date: '1',
      dirname: `files/${sha256('account-a')}/1`,
      filename: 'upload-id.png',
      path: `files/${sha256('account-a')}/1/upload-id.png`,
    });
    expect(isUserUploadKey(metadata.path, 'account-a', 'file')).toBe(true);
    expect(isUserUploadKey(metadata.path, 'account-b', 'file')).toBe(false);
    expect(isUserUploadKey(metadata.path, 'account-a', 'ragEval')).toBe(false);
  });

  it('separates RAG imports and sanitizes unsafe extensions', () => {
    const metadata = createUploadTarget({
      filename: 'dataset.jsonl/../../secret',
      purpose: 'ragEval',
      userId: 'account-a',
    });

    expect(metadata.path).toBe(`ragEval/${sha256('account-a')}/1/upload-id.bin`);
    expect(isUserUploadKey(metadata.path, 'account-a', 'ragEval')).toBe(true);
    expect(isUserUploadKey('ragEval/other/1/upload-id.bin', 'account-a', 'ragEval')).toBe(false);
  });

  it('uses an unpredictable edge namespace without accepting a requested key', () => {
    expect(createUploadTarget({ filename: 'asset.webp', purpose: 'file' })).toEqual({
      date: '1',
      dirname: 'files/edge/1',
      filename: 'upload-id.webp',
      path: 'files/edge/1/upload-id.webp',
    });
  });
});
