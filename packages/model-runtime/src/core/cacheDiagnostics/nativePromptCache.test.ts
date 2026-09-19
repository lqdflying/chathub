import { describe, expect, it } from 'vitest';

import { supportsTrustedPromptCacheKey, usesTrustedNativePromptCache } from './nativePromptCache';

describe('supportsTrustedPromptCacheKey', () => {
  it.each(['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.7-preview', 'gpt-6', 'gpt-6-mini'])(
    'supports %s',
    (model) => {
      expect(supportsTrustedPromptCacheKey(model)).toBe(true);
    },
  );

  it.each(['gpt-5', 'gpt-5.5', 'gpt-5.5-codex', 'o3', 'claude-4', 'azure-gpt-5.6-deployment'])(
    'does not support %s',
    (model) => {
      expect(supportsTrustedPromptCacheKey(model)).toBe(false);
    },
  );
});

describe('usesTrustedNativePromptCache', () => {
  it('is true for every xAI model id', () => {
    expect(usesTrustedNativePromptCache('xai', 'grok-4.6')).toBe(true);
    expect(usesTrustedNativePromptCache('xai', 'grok-build-0.1')).toBe(true);
  });

  it('stays model-gated for native OpenAI', () => {
    expect(usesTrustedNativePromptCache('openai', 'gpt-5.6-sol')).toBe(true);
    expect(usesTrustedNativePromptCache('openai', 'gpt-5.4')).toBe(false);
  });
});
