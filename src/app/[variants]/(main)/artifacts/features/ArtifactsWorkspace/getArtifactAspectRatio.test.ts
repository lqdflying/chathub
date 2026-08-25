import { describe, expect, it } from 'vitest';

import { getArtifactAspectRatio } from './getArtifactAspectRatio';

describe('getArtifactAspectRatio', () => {
  it('uses stored width and height', () => {
    expect(getArtifactAspectRatio(2560, 1440)).toBe('2560 / 1440');
    expect(getArtifactAspectRatio(768, 1024)).toBe('768 / 1024');
  });

  it('falls back to 16 / 9 when dimensions are missing', () => {
    expect(getArtifactAspectRatio()).toBe('16 / 9');
    expect(getArtifactAspectRatio(0, 1440)).toBe('16 / 9');
    expect(getArtifactAspectRatio(2560, null)).toBe('16 / 9');
  });
});
