import { describe, expect, it } from 'vitest';

import { resolveProviderTitleHelpUrl } from './resolveProviderTitleHelpUrl';

describe('resolveProviderTitleHelpUrl', () => {
  it('returns the official site for a native provider', () => {
    expect(resolveProviderTitleHelpUrl('openai', 'https://openai.com')).toBe('https://openai.com');
  });

  it('hides the icon when the official url is empty or whitespace', () => {
    expect(resolveProviderTitleHelpUrl('openai')).toBeUndefined();
    expect(resolveProviderTitleHelpUrl('openai', '')).toBeUndefined();
    expect(resolveProviderTitleHelpUrl('openai', '   ')).toBeUndefined();
  });

  it('hides the icon for OpenAI Compatible even when a url is present', () => {
    expect(
      resolveProviderTitleHelpUrl(
        'openaicompatible',
        'https://platform.openai.com/docs/api-reference',
      ),
    ).toBeUndefined();
  });

  it('hides the icon for Anthropic Compatible even when a url is present', () => {
    expect(
      resolveProviderTitleHelpUrl(
        'anthropiccompatible',
        'https://docs.anthropic.com/en/api/messages',
      ),
    ).toBeUndefined();
  });
});
