import { describe, expect, it } from 'vitest';

import {
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
  it('returns vendored Xiaomi MiMo assets while icons 2.x has no xiaomimimo', () => {
    expect(resolveProviderLogoUrl('mimo', 'avatar')).toBe('/icons/providers/mimo-avatar.webp');
    expect(resolveProviderLogoUrl('mimo', 'mono')).toBe('/icons/providers/mimo.svg');
  });

  it('returns undefined for providers without a local override', () => {
    expect(resolveProviderLogoUrl('deepseek')).toBeUndefined();
    expect(resolveProviderLogoUrl('openaicompatible')).toBeUndefined();
  });
});

describe('resolveModelLogoUrl', () => {
  it('maps mimo model ids to the local mono mark', () => {
    expect(resolveModelLogoUrl('mimo-v2.5-pro')).toBe('/icons/providers/mimo.svg');
    expect(resolveModelLogoUrl('mimo-v2.5')).toBe('/icons/providers/mimo.svg');
  });

  it('ignores unrelated model ids', () => {
    expect(resolveModelLogoUrl('deepseek-chat')).toBeUndefined();
  });
});
