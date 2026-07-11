import { describe, expect, it } from 'vitest';

import { AgentChatConfigSchema, resolveGPT5ReasoningEffort } from './chatConfig';

describe('GPT-5 reasoning effort contract', () => {
  it('preserves Sol reasoning efforts through persisted config validation', () => {
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'none' })).toMatchObject({
      gpt5ReasoningEffort: 'none',
    });
    expect(AgentChatConfigSchema.parse({ gpt5ReasoningEffort: 'max' })).toMatchObject({
      gpt5ReasoningEffort: 'max',
    });
  });

  it.each(['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'accepts %s for GPT-5.6 Sol',
    (requestedEffort) => {
      expect(resolveGPT5ReasoningEffort('gpt-5.6-sol', requestedEffort)).toEqual({
        effort: requestedEffort,
        effortValues: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      });
    },
  );

  it.each([
    ['none', 'low'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'medium'],
  ] as const)('normalizes GPT-5.5 %s to %s', (requestedEffort, expectedEffort) => {
    expect(resolveGPT5ReasoningEffort('gpt-5.5', requestedEffort)).toEqual({
      effort: expectedEffort,
      effortValues: ['low', 'medium', 'high', 'xhigh'],
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
  ] as const)('normalizes legacy GPT-5 %s to %s', (requestedEffort, expectedEffort) => {
    expect(resolveGPT5ReasoningEffort('gpt-5.4', requestedEffort)).toEqual({
      effort: expectedEffort,
      effortValues: ['minimal', 'low', 'medium', 'high'],
    });
  });

  it('defaults every model family to medium when no effort is saved', () => {
    expect(resolveGPT5ReasoningEffort('gpt-5.6-sol', undefined).effort).toBe('medium');
    expect(resolveGPT5ReasoningEffort('gpt-5.5', undefined).effort).toBe('medium');
    expect(resolveGPT5ReasoningEffort('gpt-5.4', undefined).effort).toBe('medium');
  });
});
