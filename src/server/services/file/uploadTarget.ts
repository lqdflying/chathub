import type { FileMetadata } from '@lobechat/types';
import { sha256 } from 'js-sha256';

import { fileEnv } from '@/envs/file';
import { nanoid } from '@/utils/uuid';

import { isValidUploadPathname } from './fileReference';

export type UploadPurpose = 'file' | 'ragEval';

const EDGE_UPLOAD_SCOPE = 'edge';
const RAG_EVAL_UPLOAD_ROOT = 'ragEval';

const getUploadRoot = (purpose: UploadPurpose): string => {
  const configuredRoot =
    purpose === 'ragEval' ? RAG_EVAL_UPLOAD_ROOT : fileEnv.NEXT_PUBLIC_S3_FILE_PATH || 'files';
  const root = configuredRoot.replaceAll(/^\/+|\/+$/g, '');

  if (!root || !isValidUploadPathname(`${root}/upload`)) {
    throw new Error('Invalid S3 upload root configuration');
  }

  return root;
};

const getSafeExtension = (filename: string): string => {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return 'bin';

  const extension = filename.slice(dotIndex + 1).toLowerCase();
  return /^[\da-z]{1,16}$/.test(extension) ? extension : 'bin';
};

const getAccountScope = (userId: string): string => sha256(userId);

const getUploadPrefix = (purpose: UploadPurpose, scope: string): string =>
  `${getUploadRoot(purpose)}/${scope}/`;

export const createUploadTarget = ({
  filename: originalFilename,
  purpose,
  userId,
}: {
  filename: string;
  purpose: UploadPurpose;
  userId?: string;
}): FileMetadata => {
  const date = (Date.now() / 1000 / 60 / 60).toFixed(0);
  const scope = userId ? getAccountScope(userId) : EDGE_UPLOAD_SCOPE;
  const dirname = `${getUploadPrefix(purpose, scope)}${date}`;
  const filename = `${nanoid()}.${getSafeExtension(originalFilename)}`;
  const path = `${dirname}/${filename}`;

  if (!isValidUploadPathname(path)) throw new Error('Generated an invalid S3 upload pathname');

  return { date, dirname, filename, path };
};

export const isUserUploadKey = (
  key: string,
  userId: string,
  purpose: UploadPurpose,
): boolean =>
  isValidUploadPathname(key) && key.startsWith(getUploadPrefix(purpose, getAccountScope(userId)));
