import { describe, expect, it } from 'vitest';

import {
  IMAGE_TOKEN_FALLBACK,
  estimateImageTokens,
  estimateMessageVisualTokens,
  stripInlineImagePayloads,
} from './imageTokenEstimate';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('image token estimate', () => {
  it('does not count a data URL as text and uses a documented size for a known model', () => {
    const stripped = stripInlineImagePayloads(`look ${ONE_PIXEL_PNG}`);
    expect(stripped).toBe('look [image]');
    expect(stripped).not.toContain('base64');

    const documented = estimateImageTokens(ONE_PIXEL_PNG, 'gpt-5.5');
    expect(documented.confidence).toBe('documented');
    expect(documented.tokens).toBeGreaterThan(0);
    expect(documented.tokens).toBeLessThan(IMAGE_TOKEN_FALLBACK);
  });

  it('uses the fixed allowance for a remote URL and for an unknown model', () => {
    expect(estimateImageTokens('https://example.com/a.png', 'gpt-5.5')).toEqual({
      confidence: 'heuristic',
      tokens: IMAGE_TOKEN_FALLBACK,
    });
    expect(estimateImageTokens(ONE_PIXEL_PNG, 'custom-model')).toEqual({
      confidence: 'heuristic',
      tokens: IMAGE_TOKEN_FALLBACK,
    });
  });

  it('counts listed images and videos without reading remote bytes', () => {
    const estimated = estimateMessageVisualTokens(
      {
        imageList: [{ alt: '', id: '1', url: 'https://example.com/a.png' }],
        videoList: [{ id: 'v', url: 'https://example.com/v.mp4' }],
      } as never,
      'claude-sonnet-4-5',
    );
    expect(estimated.hasVisual).toBe(true);
    expect(estimated.tokens).toBe(IMAGE_TOKEN_FALLBACK * 2);
    expect(estimated.confidence).toBe('heuristic');
  });
});