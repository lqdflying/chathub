import { describe, expect, it } from 'vitest';

import { PICBED_VIDEO_SIZE_LIMIT, validatePicbedMediaFile } from './picbedMedia';

describe('validatePicbedMediaFile', () => {
  it.each([
    ['an image of any size', { size: PICBED_VIDEO_SIZE_LIMIT * 2, type: 'image/png' }],
    ['a video at the size limit', { size: PICBED_VIDEO_SIZE_LIMIT, type: 'video/mp4' }],
    ['another supported video type', { size: 1, type: 'video/webm' }],
  ])('accepts %s', (_caseName, file) => {
    expect(validatePicbedMediaFile(file)).toEqual({ isValid: true });
  });

  it('rejects a video one byte over the size limit', () => {
    expect(
      validatePicbedMediaFile({ size: PICBED_VIDEO_SIZE_LIMIT + 1, type: 'video/mp4' }),
    ).toMatchObject({ isValid: false, reason: 'videoSizeExceeded' });
  });

  it('rejects non-media MIME types', () => {
    expect(validatePicbedMediaFile({ size: 1, type: 'application/pdf' })).toEqual({
      isValid: false,
      reason: 'unsupportedType',
    });
  });
});
