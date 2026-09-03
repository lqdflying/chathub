import { describe, expect, it } from 'vitest';

import anthropicChatModels from './aiModels/anthropic';
import anthropiccompatible from './aiModels/anthropiccompatible';
import openaiChatModels, { gptImage1ParamsSchema } from './aiModels/openai';
import openaicompatible, {
  GPT_IMAGE_2_SIZE_PRESETS,
  OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
  gptImage2CompatibleParamsSchema,
} from './aiModels/openaicompatible';

describe('compatible provider fixed model lists', () => {
  it('locks OpenAI Compatible to GPT-5.6 Sol, GPT-5.5, and GPT Image 2', () => {
    const sourceGpt56Sol = openaiChatModels.find((model) => model.id === 'gpt-5.6-sol');
    const sourceGpt55 = openaiChatModels.find((model) => model.id === 'gpt-5.5');
    expect(sourceGpt56Sol).toMatchObject({
      abilities: {
        functionCall: true,
        reasoning: true,
        search: true,
        structuredOutput: true,
        vision: true,
      },
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-5.6 Sol',
      maxOutput: 128_000,
      pricing: {
        units: [
          { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      releasedAt: '2026-07-09',
      settings: {
        extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
        searchImpl: 'params',
      },
    });
    expect(sourceGpt55).toMatchObject({
      contextWindowTokens: 1_050_000,
      maxOutput: 128_000,
    });
    expect(openaicompatible.map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.5',
      'gpt-image-2',
    ]);

    for (const modelId of ['gpt-5.6-sol', 'gpt-5.5']) {
      const compatibleModel = openaicompatible.find((model) => model.id === modelId);
      expect(compatibleModel).toMatchObject({
        abilities: {
          search: false,
        },
        contextWindowTokens: OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS,
        enabled: true,
        settings: {
          extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
          searchImpl: 'params',
        },
        type: 'chat',
      });
      expect(compatibleModel?.settings).not.toHaveProperty('searchProvider');
    }

    expect(openaicompatible.find((model) => model.id === 'gpt-image-2')).toMatchObject({
      enabled: true,
      parameters: gptImage2CompatibleParamsSchema,
      resolutions: [...GPT_IMAGE_2_SIZE_PRESETS],
      type: 'image',
    });
    expect(gptImage2CompatibleParamsSchema.size).toEqual({
      custom: {
        experimentalPixelThreshold: 3_686_400,
        maxAspectRatio: 3,
        maxEdge: 3840,
        maxPixels: 8_294_400,
        minPixels: 655_360,
        step: 16,
      },
      default: 'auto',
      enum: [...GPT_IMAGE_2_SIZE_PRESETS],
      groups: [
        { key: 'standard', values: ['1024x1024', '1536x1024', '1024x1536'] },
        { key: '2k', values: ['2560x1440', '1440x2560'] },
        { key: '4k', values: ['3840x2160', '2160x3840'] },
      ],
    });
    expect(gptImage2CompatibleParamsSchema).not.toBe(gptImage1ParamsSchema);
    expect(gptImage2CompatibleParamsSchema.size).not.toEqual(gptImage1ParamsSchema.size);
  });

  it('locks Anthropic Compatible to Claude 4.6 models', () => {
    const sourceModelIds = new Set(anthropicChatModels.map((model) => model.id));
    expect(['claude-sonnet-4-6', 'claude-opus-4-6'].every((id) => sourceModelIds.has(id))).toBe(
      true,
    );
    expect(anthropiccompatible.map((model) => model.id)).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-6',
    ]);
    expect(anthropiccompatible.every((model) => model.enabled)).toBe(true);
    expect(anthropiccompatible.every((model) => model.abilities?.search === false)).toBe(true);
    expect(anthropiccompatible.every((model) => model.settings?.extendParams?.length)).toBe(true);
    expect(anthropiccompatible.every((model) => model.settings?.searchImpl === 'params')).toBe(
      true,
    );
    expect(anthropiccompatible.every((model) => !model.settings?.searchProvider)).toBe(true);
  });
});
