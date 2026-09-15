import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PROVIDER_LIST } from '@/config/modelProviders';

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

  it('returns a local avatar tile for every builtin provider, including compat aliases', () => {
    for (const provider of DEFAULT_MODEL_PROVIDER_LIST) {
      expect(resolveProviderLogoUrl(provider.id), provider.id).toMatch(
        /^\/icons\/providers\/.+-avatar\.webp$/,
      );
    }

    expect(resolveProviderLogoUrl('openaicompatible')).toBe('/icons/providers/openai-avatar.webp');
    expect(resolveProviderLogoUrl('anthropiccompatible')).toBe(
      '/icons/providers/anthropic-avatar.webp',
    );
    expect(resolveProviderLogoUrl('deepseek')).toBe('/icons/providers/deepseek-avatar.webp');
  });

  it('ships the webp files referenced by builtin providers', () => {
    const publicRoot = join(process.cwd(), 'public');
    for (const provider of DEFAULT_MODEL_PROVIDER_LIST) {
      const url = resolveProviderLogoUrl(provider.id);
      expect(url, provider.id).toBeTruthy();
      expect(existsSync(join(publicRoot, url!.replace(/^\//, ''))), url).toBe(true);
    }
  });

  it('returns undefined for providers without a local override', () => {
    expect(resolveProviderLogoUrl('not-exist-provider')).toBeUndefined();
    expect(resolveProviderLogoUrl('acme')).toBeUndefined();
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
