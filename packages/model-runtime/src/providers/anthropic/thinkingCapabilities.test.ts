import { anthropicChatModels } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  getAnthropicRuntimeMaxOutput,
  isAnthropicAdaptiveThinkingOnlyModel,
  isAnthropicAlwaysOnThinkingModel,
} from './thinkingCapabilities';

describe('anthropic thinking capabilities', () => {
  it.each(['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7'])(
    'treats %s as adaptive-only',
    (model) => {
      expect(isAnthropicAdaptiveThinkingOnlyModel(model)).toBe(true);
    },
  );

  it('does not treat hybrid 4.6 models as adaptive-only', () => {
    expect(isAnthropicAdaptiveThinkingOnlyModel('claude-opus-4-6')).toBe(false);
    expect(isAnthropicAdaptiveThinkingOnlyModel('claude-sonnet-4-6')).toBe(false);
  });

  it('marks Fable 5.1 as always-on thinking', () => {
    expect(isAnthropicAlwaysOnThinkingModel('claude-fable-5-1')).toBe(true);
    expect(isAnthropicAlwaysOnThinkingModel('claude-sonnet-5')).toBe(false);
  });

  it('keeps pruned Claude 3.7 and Haiku output limits for saved ids', () => {
    expect(getAnthropicRuntimeMaxOutput('claude-3-7-sonnet-20250219')).toBe(64_000);
    expect(getAnthropicRuntimeMaxOutput('claude-3-haiku-20240307')).toBe(4096);
  });

  it('does not re-enable pruned Claude 3.x cards in the visible picker', () => {
    expect(anthropicChatModels.some((model) => model.id === 'claude-3-7-sonnet-20250219')).toBe(
      false,
    );
    expect(anthropicChatModels.some((model) => model.id === 'claude-3-haiku-20240307')).toBe(
      false,
    );
  });
});
