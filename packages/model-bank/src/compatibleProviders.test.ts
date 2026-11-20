import { describe, expect, it } from 'vitest';

import { findRetiredModelCard } from './aiModels';
import anthropicChatModels from './aiModels/anthropic';
import anthropiccompatible from './aiModels/anthropiccompatible';
import openaiChatModels, { gptImage1ParamsSchema } from './aiModels/openai';
import openaicompatible, {
  GPT_IMAGE_2_SIZE_PRESETS,
  gptImage2CompatibleParamsSchema,
} from './aiModels/openaicompatible';

describe('compatible provider fixed model lists', () => {
  it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'])(
    'keeps the former OpenAI Compatible card %s as a retired card outside the picker',
    (modelId) => {
      expect(findRetiredModelCard(modelId, 'openaicompatible')).toMatchObject({
        abilities: { functionCall: true, reasoning: true, search: false, vision: true },
        contextWindowTokens: 1_050_000,
        id: modelId,
        maxOutput: 128_000,
        providerId: 'openaicompatible',
        settings: {
          extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
          searchImpl: 'params',
        },
        type: 'chat',
      });
      expect(openaicompatible.some((model) => model.id === modelId)).toBe(false);
    },
  );

  it('has no retired OpenAI Compatible card for an id that is still listed', () => {
    expect(findRetiredModelCard('gpt-6.2-astra', 'openaicompatible')).toBeUndefined();
    expect(findRetiredModelCard('gpt-6.1-sol', 'openaicompatible')).toBeUndefined();
  });

  it('locks OpenAI Compatible to GPT-6.2 Astra, GPT-6.1 Sol, and GPT Image 2', () => {
    const sourceGpt62Astra = openaiChatModels.find((model) => model.id === 'gpt-6.2-astra');
    const sourceGpt61Sol = openaiChatModels.find((model) => model.id === 'gpt-6.1-sol');
    expect(sourceGpt62Astra).toMatchObject({
      abilities: {
        functionCall: true,
        reasoning: true,
        search: true,
        structuredOutput: true,
        vision: true,
      },
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-6.2 Astra',
      enabled: true,
      maxOutput: 128_000,
      pricing: {
        units: [
          { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      releasedAt: '2026-11-17',
      settings: {
        extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
        searchImpl: 'params',
      },
      type: 'chat',
    });
    expect(sourceGpt61Sol).toMatchObject({
      abilities: {
        functionCall: true,
        reasoning: true,
        search: true,
        structuredOutput: true,
        vision: true,
      },
      contextWindowTokens: 1_050_000,
      displayName: 'GPT-6.1 Sol',
      enabled: true,
      maxOutput: 128_000,
      pricing: {
        units: [
          { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      releasedAt: '2026-09-29',
      settings: {
        extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
        searchImpl: 'params',
      },
    });
    expect(openaicompatible.map((model) => model.id)).toEqual([
      'gpt-6.2-astra',
      'gpt-6.1-sol',
      'gpt-image-2',
    ]);

    for (const modelId of ['gpt-6.2-astra', 'gpt-6.1-sol']) {
      const compatibleModel = openaicompatible.find((model) => model.id === modelId);
      expect(compatibleModel).toMatchObject({
        abilities: {
          search: false,
        },
        contextWindowTokens: 1_050_000,
        enabled: true,
        maxOutput: 128_000,
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

  it('locks Anthropic Compatible to Claude Sonnet 5.5 and Claude Opus 5.5', () => {
    const sourceModelIds = new Set(anthropicChatModels.map((model) => model.id));
    expect(['claude-sonnet-5-5', 'claude-opus-5-5'].every((id) => sourceModelIds.has(id))).toBe(
      true,
    );
    expect(anthropiccompatible.map((model) => model.id)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
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
