import { describe, expect, it } from 'vitest';

import { resolveAzureChatCompletionsReasoningEffort } from './gpt56ChatCompletionsTools';

describe('resolveAzureChatCompletionsReasoningEffort', () => {
  it('forces none when GPT-5.6 Chat Completions includes tools', () => {
    expect(
      resolveAzureChatCompletionsReasoningEffort('gpt-5.6-sol', [{ type: 'function' }], 'high'),
    ).toBe('none');
    expect(
      resolveAzureChatCompletionsReasoningEffort('gpt-5.6-terra', [{ type: 'function' }], undefined),
    ).toBe('none');
  });

  it('preserves selected effort when GPT-5.6 has no tools', () => {
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-sol', [], 'high')).toBe('high');
    expect(resolveAzureChatCompletionsReasoningEffort('gpt-5.6-luna', undefined, undefined)).toBe(
      undefined,
    );
  });

  it('does not force none for GPT-5.5 tool chats', () => {
    expect(
      resolveAzureChatCompletionsReasoningEffort('gpt-5.5', [{ type: 'function' }], 'high'),
    ).toBe('high');
  });
});
