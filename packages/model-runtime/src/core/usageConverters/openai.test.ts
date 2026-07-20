import type { Pricing } from 'model-bank';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { convertOpenAIImageUsage, convertOpenAIResponseUsage, convertOpenAIUsage } from './openai';

describe('convertUsage', () => {
  it('should convert basic OpenAI usage data correctly', () => {
    // Arrange
    const openaiUsage: OpenAI.Completions.CompletionUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };

    // Act
    const result = convertOpenAIUsage(openaiUsage);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 150,
    });
  });

  it('should handle PPLX citation tokens correctly', () => {
    // Arrange
    const pplxUsage = {
      prompt_tokens: 80,
      citation_tokens: 20,
      completion_tokens: 50,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(pplxUsage);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 80,
      inputCitationTokens: 20,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 170, // 150 + 20 (citation tokens)
    });
  });

  it('should handle cached tokens correctly', () => {
    // Arrange
    const usageWithCache = {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 30,
      prompt_cache_miss_tokens: 70,
      completion_tokens: 50,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithCache);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      inputCachedTokens: 30,
      inputCacheMissTokens: 70,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 150,
    });
  });

  it('should handle cached tokens using prompt_tokens_details', () => {
    // Arrange
    const usageWithTokenDetails = {
      prompt_tokens: 100,
      prompt_tokens_details: {
        cached_tokens: 30,
      },
      completion_tokens: 50,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithTokenDetails);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      inputCachedTokens: 30,
      inputCacheMissTokens: 70, // 100 - 30
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 150,
    });
  });

  it('should handle top-level cached tokens from compatible providers', () => {
    const usageWithTopLevelCachedTokens = {
      cached_tokens: 30,
      completion_tokens: 50,
      prompt_tokens: 100,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    const result = convertOpenAIUsage(usageWithTopLevelCachedTokens);

    expect(result).toEqual({
      inputCacheMissTokens: 70,
      inputCachedTokens: 30,
      inputTextTokens: 100,
      outputTextTokens: 50,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
    });
  });

  it('should preserve zero cache misses for full compatible-provider cache hits', () => {
    const fullCacheHitUsage = {
      cached_tokens: 100,
      completion_tokens: 50,
      prompt_tokens: 100,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    const result = convertOpenAIUsage(fullCacheHitUsage, {
      provider: 'openaicompatible',
    });

    expect(result).toMatchObject({
      inputCacheMissTokens: 0,
      inputCachedTokens: 100,
    });
  });

  it('should preserve reported zero cache counters without inventing omitted counters', () => {
    const usageWithReportedZeroes = {
      cache_write_tokens: 0,
      completion_tokens: 0,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    } as OpenAI.Completions.CompletionUsage;

    expect(convertOpenAIUsage(usageWithReportedZeroes)).toMatchObject({
      inputCacheMissTokens: 0,
      inputCachedTokens: 0,
      inputWriteCacheTokens: 0,
      outputTextTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    });

    const usageWithoutCacheTelemetry = {
      completion_tokens: 5,
      prompt_tokens: 10,
      total_tokens: 15,
    } as OpenAI.Completions.CompletionUsage;

    expect(convertOpenAIUsage(usageWithoutCacheTelemetry)).not.toHaveProperty(
      'inputCacheMissTokens',
    );
    expect(convertOpenAIUsage(usageWithoutCacheTelemetry)).not.toHaveProperty('inputCachedTokens');
    expect(convertOpenAIUsage(usageWithoutCacheTelemetry)).not.toHaveProperty(
      'inputWriteCacheTokens',
    );
  });

  it('should preserve cache write tokens from compatible providers', () => {
    const usageWithCacheWrite = {
      cache_write_tokens: 80,
      completion_tokens: 5,
      prompt_tokens: 80,
      total_tokens: 85,
    } as OpenAI.Completions.CompletionUsage;

    expect(convertOpenAIUsage(usageWithCacheWrite)).toMatchObject({
      inputWriteCacheTokens: 80,
    });
  });

  it('should preserve nested Chat Completions cache write tokens', () => {
    const usageWithCacheWrite = {
      completion_tokens: 5,
      prompt_tokens: 80,
      prompt_tokens_details: {
        cache_write_tokens: 80,
        cached_tokens: 0,
      },
      total_tokens: 85,
    } as OpenAI.Completions.CompletionUsage;

    expect(convertOpenAIUsage(usageWithCacheWrite)).toMatchObject({
      inputWriteCacheTokens: 80,
    });
  });

  it('should handle audio tokens in input correctly', () => {
    // Arrange
    const usageWithAudioInput = {
      prompt_tokens: 100,
      prompt_tokens_details: {
        audio_tokens: 20,
      },
      completion_tokens: 50,
      total_tokens: 150,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithAudioInput);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      inputAudioTokens: 20,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 150,
    });
  });

  it('should handle detailed output tokens correctly', () => {
    // Arrange
    const usageWithOutputDetails = {
      prompt_tokens: 100,
      completion_tokens: 100,
      completion_tokens_details: {
        reasoning_tokens: 30,
        audio_tokens: 20,
      },
      total_tokens: 200,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithOutputDetails);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      totalInputTokens: 100,
      totalOutputTokens: 100,
      outputReasoningTokens: 30,
      outputAudioTokens: 20,
      outputTextTokens: 50, // 100 - 30 - 20
      totalTokens: 200,
    });
  });

  it('should handle prediction tokens correctly', () => {
    // Arrange
    const usageWithPredictions = {
      prompt_tokens: 100,
      completion_tokens: 80,
      completion_tokens_details: {
        accepted_prediction_tokens: 30,
        rejected_prediction_tokens: 10,
      },
      total_tokens: 180,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithPredictions);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      totalInputTokens: 100,
      totalOutputTokens: 80,
      outputTextTokens: 80,
      acceptedPredictionTokens: 30,
      rejectedPredictionTokens: 10,
      totalTokens: 180,
    });
  });

  it('should handle complex usage with all fields correctly', () => {
    // Arrange
    const complexUsage = {
      prompt_tokens: 150,
      prompt_tokens_details: {
        audio_tokens: 50,
        cached_tokens: 40,
      },
      citation_tokens: 30,
      completion_tokens: 120,
      completion_tokens_details: {
        reasoning_tokens: 40,
        audio_tokens: 30,
        accepted_prediction_tokens: 20,
        rejected_prediction_tokens: 5,
      },
      total_tokens: 300,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(complexUsage);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 150,
      inputAudioTokens: 50,
      inputCachedTokens: 40,
      inputCacheMissTokens: 140, // 180 - 40 (totalInputTokens - cachedTokens)
      inputCitationTokens: 30,
      totalInputTokens: 180, // 150 + 30
      outputTextTokens: 50, // 120 - 40 - 30
      outputReasoningTokens: 40,
      outputAudioTokens: 30,
      totalOutputTokens: 120,
      acceptedPredictionTokens: 20,
      rejectedPredictionTokens: 5,
      totalTokens: 330, // 300 + 30 (citation_tokens)
    });
  });

  it('should preserve reported zero values and omit undefined values', () => {
    // Arrange
    const usageWithZeros = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: undefined,
      },
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithZeros);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      outputReasoningTokens: 0,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      outputTextTokens: 50,
      totalTokens: 150,
    });

    expect(result).not.toHaveProperty('outputAudioTokens');
  });

  it('should handle XAI provider correctly where completion_tokens does not include reasoning_tokens', () => {
    // Arrange
    const xaiUsage: OpenAI.Completions.CompletionUsage = {
      prompt_tokens: 6103,
      completion_tokens: 66, // 这个不包含 reasoning_tokens
      total_tokens: 6550,
      prompt_tokens_details: {
        audio_tokens: 0,
        cached_tokens: 0,
      },
      completion_tokens_details: {
        accepted_prediction_tokens: 0,
        audio_tokens: 0,
        reasoning_tokens: 381, // 这是额外的 reasoning tokens
        rejected_prediction_tokens: 0,
      },
    };

    // Act
    const xaiResult = convertOpenAIUsage(xaiUsage, {
      provider: 'xai',
    });

    // Assert
    expect(xaiResult).toMatchObject({
      totalInputTokens: 6103,
      totalOutputTokens: 447, // 66 + 381，xai的reasoning_tokens和completion_tokens价格一样
      outputTextTokens: 66, // 不减去 reasoning_tokens
      outputReasoningTokens: 381,
      totalTokens: 6550,
    });

    // 测试其他 provider（默认行为）
    const defaultResult = convertOpenAIUsage(xaiUsage);

    // 默认行为: outputTextTokens 应该是 completion_tokens - reasoning_tokens - audio_tokens = 66 - 381 - 0 = -315
    expect(defaultResult.outputTextTokens).toBe(-315);
    expect(defaultResult).toMatchObject({
      totalInputTokens: 6103,
      totalOutputTokens: 66,
      outputTextTokens: -315, // 负数确实会出现在结果中
      outputReasoningTokens: 381,
      totalTokens: 6550,
    });
  });

  it('should handle output image tokens correctly', () => {
    // Arrange
    const usageWithImage = {
      prompt_tokens: 100,
      completion_tokens: 200,
      completion_tokens_details: {
        image_tokens: 60,
        reasoning_tokens: 30,
      },
      total_tokens: 300,
    } as OpenAI.Completions.CompletionUsage;

    // Act
    const result = convertOpenAIUsage(usageWithImage);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      totalInputTokens: 100,
      totalOutputTokens: 200,
      outputImageTokens: 60,
      outputReasoningTokens: 30,
      outputTextTokens: 110, // 200 - 60 - 30
      totalTokens: 300,
    });
  });

  it('should handle response output image tokens correctly for ResponseUsage', () => {
    // Arrange
    const responseUsage = {
      input_tokens: 100,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 200,
      output_tokens_details: {
        image_tokens: 60,
        reasoning_tokens: 30,
      },
      total_tokens: 300,
    } as OpenAI.Responses.ResponseUsage;

    // Act
    const result = convertOpenAIResponseUsage(responseUsage);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 100,
      inputCacheMissTokens: 100, // 100 - 0
      inputCachedTokens: 0,
      totalInputTokens: 100,
      totalOutputTokens: 200,
      outputImageTokens: 60,
      outputReasoningTokens: 30,
      outputTextTokens: 110, // 200 - 30 - 60
      totalTokens: 300,
    });
  });

  it('should keep missing Responses cache telemetry unknown', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };
    const responseUsage = {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      total_tokens: 1_500_000,
    } as OpenAI.Responses.ResponseUsage;

    const result = convertOpenAIResponseUsage(responseUsage, { pricing });

    expect(result).not.toHaveProperty('inputCachedTokens');
    expect(result).not.toHaveProperty('inputCacheMissTokens');
    expect(result.cost).toBeCloseTo(4, 10);
  });

  it('should calculate partial Responses cache hits', () => {
    const responseUsage = {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 50,
      total_tokens: 150,
    } as OpenAI.Responses.ResponseUsage;

    const result = convertOpenAIResponseUsage(responseUsage);

    expect(result).toMatchObject({
      inputCacheMissTokens: 60,
      inputCachedTokens: 40,
    });
  });

  it('should preserve Responses cache write and reported zero counters', () => {
    const responseUsage = {
      cache_write_tokens: 0,
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      total_tokens: 0,
    } as OpenAI.Responses.ResponseUsage;

    expect(convertOpenAIResponseUsage(responseUsage)).toMatchObject({
      inputCacheMissTokens: 0,
      inputCachedTokens: 0,
      inputWriteCacheTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
    });
  });

  it('should preserve nested Responses cache write tokens', () => {
    const responseUsage = {
      input_tokens: 80,
      input_tokens_details: {
        cache_write_tokens: 80,
        cached_tokens: 0,
      },
      output_tokens: 5,
      total_tokens: 85,
    } as OpenAI.Responses.ResponseUsage;

    expect(convertOpenAIResponseUsage(responseUsage)).toMatchObject({
      inputWriteCacheTokens: 80,
    });
  });

  it('should accept top-level cached tokens from compatible Responses providers', () => {
    const responseUsage = {
      cached_tokens: 75,
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 110,
    } as OpenAI.Responses.ResponseUsage;

    expect(convertOpenAIResponseUsage(responseUsage)).toMatchObject({
      inputCacheMissTokens: 25,
      inputCachedTokens: 75,
    });
  });

  it('should preserve and price full Responses cache hits', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };
    const responseUsage = {
      input_tokens: 1_000_000,
      input_tokens_details: { cached_tokens: 1_000_000 },
      output_tokens: 500_000,
      total_tokens: 1_500_000,
    } as OpenAI.Responses.ResponseUsage;

    const result = convertOpenAIResponseUsage(responseUsage, { pricing });

    expect(result).toMatchObject({
      inputCacheMissTokens: 0,
      inputCachedTokens: 1_000_000,
    });
    expect(result.cost).toBeCloseTo(2.5, 10);
  });

  it('should enrich completion usage with pricing cost when pricing is provided', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    const usage: OpenAI.Completions.CompletionUsage = {
      completion_tokens: 500_000,
      prompt_tokens: 1_000_000,
      total_tokens: 1_500_000,
    };

    const result = convertOpenAIUsage(usage, { pricing });

    expect(result.cost).toBeCloseTo(2, 10);
  });

  it('should enrich response usage with pricing cost when pricing is provided', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    const responseUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      total_tokens: 2_000_000,
    } as OpenAI.Responses.ResponseUsage;

    const result = convertOpenAIResponseUsage(responseUsage, { pricing });

    expect(result.cost).toBeCloseTo(2, 10);
  });
});

describe('convertOpenAIImageUsage', () => {
  it('should convert gpt-image-1 usage data correctly', () => {
    // Arrange - Based on actual gpt-image-1 logs
    const gptImage1Usage: OpenAI.Images.ImagesResponse.Usage = {
      input_tokens: 14,
      input_tokens_details: {
        text_tokens: 14,
        image_tokens: 0,
      },
      output_tokens: 4160,
      total_tokens: 4174,
    };

    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    // Act
    const result = convertOpenAIImageUsage(gptImage1Usage, pricing);

    // Assert
    expect(result).toEqual({
      inputTextTokens: 14,
      inputImageTokens: 0,
      outputImageTokens: 4160,
      totalInputTokens: 14,
      totalOutputTokens: 4160,
      totalTokens: 4174,
      cost: 0.16647, // Based on pricing: 14 * 5/1M + 0 * 10/1M + 4160 * 40/1M = 0.00007 + 0 + 0.1664 = 0.16647
    });
  });
});
