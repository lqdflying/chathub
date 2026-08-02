import { formatSize } from '@lobechat/utils';

export const PICBED_VIDEO_SIZE_LIMIT = 20 * 1024 * 1024;

export type PicbedMediaValidationReason = 'unsupportedType' | 'videoSizeExceeded';

export type PicbedMediaValidationResult =
  | { isValid: true }
  | {
      actualSize?: string;
      isValid: false;
      reason: PicbedMediaValidationReason;
    };

export const isPicbedMediaType = (fileType: string) =>
  fileType.startsWith('image/') || fileType.startsWith('video/');

export const validatePicbedMediaFile = (
  file: Pick<File, 'size' | 'type'>,
): PicbedMediaValidationResult => {
  if (!isPicbedMediaType(file.type)) {
    return { isValid: false, reason: 'unsupportedType' };
  }

  if (file.type.startsWith('video/') && file.size > PICBED_VIDEO_SIZE_LIMIT) {
    return {
      actualSize: formatSize(file.size),
      isValid: false,
      reason: 'videoSizeExceeded',
    };
  }

  return { isValid: true };
};
