import { anthropicChatModels } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  anthropicNoForcedToolChoiceModels,
  getAnthropicDefaultEffort,
  getAnthropicRuntimeMaxOutput,
  isAnthropicAdaptiveThinkingOnlyModel,
  isAnthropicAlwaysOnThinkingModel,
  supportsAnthropicAdaptiveThinking,
} from './thinkingCapabilities';

describe('anthropic thinking capabilities', () => {
  it.each([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
  ])('treats %s as adaptive-only', (model) => {
    expect(isAnthropicAdaptiveThinkingOnlyModel(model)).toBe(true);
    expect(supportsAnthropicAdaptiveThinking(model)).toBe(true);
  });

  it('does not treat hybrid 4.6 models as adaptive-only', () => {
    expect(isAnthropicAdaptiveThinkingOnlyModel('claude-opus-4-6')).toBe(false);
    expect(isAnthropicAdaptiveThinkingOnlyModel('claude-sonnet-4-6')).toBe(false);
  });

  it('marks Fable 5.1, Opus 5.5, and Sonnet 5.5 as always-on thinking', () => {
    expect(isAnthropicAlwaysOnThinkingModel('claude-fable-5-1')).toBe(true);
    expect(isAnthropicAlwaysOnThinkingModel('claude-opus-5-5')).toBe(true);
    expect(isAnthropicAlwaysOnThinkingModel('claude-sonnet-5-5')).toBe(true);
    expect(isAnthropicAlwaysOnThinkingModel('claude-haiku-5-5')).toBe(false);
    expect(isAnthropicAlwaysOnThinkingModel('claude-sonnet-5')).toBe(false);
  });

  it('uses each model API default effort', () => {
    expect(getAnthropicDefaultEffort('claude-opus-5-5')).toBe('medium');
    expect(getAnthropicDefaultEffort('claude-haiku-5-5')).toBe('medium');
    expect(getAnthropicDefaultEffort('claude-sonnet-5-5')).toBe('high');
    expect(getAnthropicDefaultEffort('claude-fable-5-1')).toBe('high');
    expect(getAnthropicDefaultEffort('claude-opus-5')).toBe('high');
  });

  it('lists the models that reject forced tool_choice', () => {
    expect([...anthropicNoForcedToolChoiceModels]).toEqual([
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  it('keeps pruned Claude 3.7 and Haiku output limits for saved ids', () => {
    expect(getAnthropicRuntimeMaxOutput('claude-3-7-sonnet-20250219')).toBe(64_000);
    expect(getAnthropicRuntimeMaxOutput('claude-3-haiku-20240307')).toBe(4096);
  });

  it('keeps legacy 2026 output limits for saved ids that left the picker', () => {
    expect(getAnthropicRuntimeMaxOutput('claude-opus-5')).toBe(128_000);
    expect(getAnthropicRuntimeMaxOutput('claude-sonnet-5')).toBe(128_000);
    expect(getAnthropicRuntimeMaxOutput('claude-opus-4-8')).toBe(128_000);
    expect(getAnthropicRuntimeMaxOutput('claude-opus-4-7')).toBe(128_000);
    expect(getAnthropicRuntimeMaxOutput('claude-opus-4-6')).toBe(128_000);
    expect(getAnthropicRuntimeMaxOutput('claude-sonnet-4-6')).toBe(64_000);
  });

  it('shows only the current Claude lineup in the visible picker', () => {
    expect(anthropicChatModels.map((model) => model.id)).toEqual([
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
    for (const model of anthropicChatModels) {
      expect(getAnthropicRuntimeMaxOutput(model.id)).toBeUndefined();
    }
  });
});
