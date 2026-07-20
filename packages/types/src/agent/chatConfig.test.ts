import { describe, expect, it } from 'vitest';

import { AgentChatConfigSchema, resolveGPT5ReasoningEffort } from './chatConfig';

describe('GPT-5 reasoning effort contract', () => {
  it('preserves legacy reasoning efforts through persisted config validation', () => {
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'none' })).toMatchObject({
      gpt5ReasoningEffort: 'none',
    });
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'minimal' })).toMatchObject({
      gpt5ReasoningEffort: 'minimal',
    });
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'medium' })).toMatchObject({
      gpt5ReasoningEffort: 'medium',
    });
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'max' })).toMatchObject({
      gpt5ReasoningEffort: 'max',
    });
  });

  it.each([
    ['none', 'high'],
    ['minimal', 'high'],
    ['low', 'high'],
    ['medium', 'high'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
    [undefined, 'high'],
  ] as const)('normalizes GPT-5.6 Sol %s to %s', (requestedEffort, expectedEffort) => {
    expect(resolveGPT5ReasoningEffort('gpt-5.6-sol', requestedEffort)).toEqual({
      effort: expectedEffort,
      effortValues: ['high', 'xhigh', 'max'],
    });
  });

  it.each([
    ['none', 'high'],
    ['minimal', 'high'],
    ['low', 'high'],
    ['medium', 'high'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'high'],
    [undefined, 'high'],
  ] as const)('normalizes GPT-5.5 %s to %s', (requestedEffort, expectedEffort) => {
    expect(resolveGPT5ReasoningEffort('gpt-5.5', requestedEffort)).toEqual({
      effort: expectedEffort,
      effortValues: ['high', 'xhigh'],
    });
  });

  it('applies the GPT-5.5 floor to dated model IDs', () => {
    expect(resolveGPT5ReasoningEffort('gpt-5.5-2026-04-23', 'low')).toEqual({
      effort: 'high',
      effortValues: ['high', 'xhigh'],
    });
  });

  it.each([
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['none', 'medium'],
    ['xhigh', 'medium'],
    ['max', 'medium'],
    [undefined, 'medium'],
  ] as const)('normalizes legacy GPT-5 %s to %s', (requestedEffort, expectedEffort) => {
    expect(resolveGPT5ReasoningEffort('gpt-5.4', requestedEffort)).toEqual({
      effort: expectedEffort,
      effortValues: ['minimal', 'low', 'medium', 'high'],
    });
  });
});
