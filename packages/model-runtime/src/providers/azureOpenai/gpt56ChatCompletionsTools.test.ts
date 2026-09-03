import { describe, expect, it } from 'vitest';

import { resolveAzureChatCompletionsReasoningEffort } from './gpt56ChatCompletionsTools';

const tools = [{ type: 'function' }];

describe('resolveAzureChatCompletionsReasoningEffort', () => {
  it('forces none when GPT-5.6 Chat Completions includes tools', () => {
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-sol', tools, 'high')).toBe('none');
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-terra', tools, undefined)).toBe(
      'none',
    );
  });

  it('preserves selected effort when GPT-5.6 has no tools', () => {
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-sol', [], 'high')).toBe('high');
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-luna', undefined, undefined)).toBe(
      undefined,
    );
  });

  it('does not force none for GPT-5.5 tool chats', () => {
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.5', tools, 'high')).toBe('high');
  });

  it('forces none for a custom deployment when the trusted catalog is GPT-5.6', () => {
    expect(
      resolveAzureChatCompletionsReasoningEffort('production-sol', tools, 'high', 'gpt-5.6-sol'),
    ).toBe('none');
  });

  it('does not treat a custom deployment as GPT-5.6 without a trusted catalog', () => {
    expect(resolveAzureChatCompletionsReasoningEffort('production-sol', tools, 'high')).toBe(
      'high',
    );
  });

  it('does not let a trusted non-GPT-5.6 catalog force none', () => {
    expect(
      resolveAzureChatCompletionsReasoningEffort('production-sol', tools, 'high', 'gpt-5.5'),
    ).toBe('high');
  });
});
