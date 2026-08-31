import { describe, expect, it } from 'vitest';

import {
  hasLocalProviderMono,
  isMimoModelId,
  resolveModelLogoUrl,
  resolveProviderIcon,
  resolveProviderLogoUrl,
} from '../resolveProviderIcon';

describe('resolveProviderIcon', () => {
  it('aliases compatibility providers to icon package keys', () => {
    expect(resolveProviderIcon('openaicompatible')).toBe('openai');
    expect(resolveProviderIcon('anthropiccompatible')).toBe('anthropic');
  });

  it('passes through unknown and native ids', () => {
    expect(resolveProviderIcon('mimo')).toBe('mimo');
    expect(resolveProviderIcon('deepseek')).toBe('deepseek');
  });
});

describe('resolveProviderLogoUrl', () => {
  it('returns the vendored avatar webp for mimo avatar requests', () => {
    expect(resolveProviderLogoUrl('mimo', 'avatar')).toBe('/icons/providers/mimo-avatar.webp');
    expect(resolveProviderLogoUrl('mimo')).toBe('/icons/providers/mimo-avatar.webp');
  });

  it('does not return the mono SVG URL (inline XiaomiMiMoMono must be used instead)', () => {
    expect(resolveProviderLogoUrl('mimo', 'mono')).toBeUndefined();
    expect(hasLocalProviderMono('mimo')).toBe(true);
    expect(hasLocalProviderMono('deepseek')).toBe(false);
  });

  it('returns undefined for providers without a local override', () => {
    expect(resolveProviderLogoUrl('deepseek')).toBeUndefined();
    expect(resolveProviderLogoUrl('openaicompatible')).toBeUndefined();
  });
});

describe('resolveModelLogoUrl', () => {
  it('maps mimo model ids to the avatar asset by default', () => {
    expect(resolveModelLogoUrl('mimo-v2.5-pro')).toBe('/icons/providers/mimo-avatar.webp');
    expect(resolveModelLogoUrl('mimo-v2.5', 'avatar')).toBe('/icons/providers/mimo-avatar.webp');
    expect(isMimoModelId('mimo-v2.5-pro')).toBe(true);
  });

  it('does not return a mono URL for models (inline SVG path)', () => {
    expect(resolveModelLogoUrl('mimo-v2.5-pro', 'mono')).toBeUndefined();
  });

  it('ignores unrelated model ids', () => {
    expect(resolveModelLogoUrl('deepseek-chat')).toBeUndefined();
    expect(isMimoModelId('deepseek-chat')).toBe(false);
  });
});
