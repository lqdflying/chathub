import { ModelTokensUsage, ModelUsage } from '@lobechat/types';
import debug from 'debug';
import { Pricing } from 'model-bank';
import OpenAI from 'openai';

import { ChatPayloadForTransformStream } from '../streams/protocol';
import { withUsageCost } from './utils/withUsageCost';

const log = debug('lobe-cost:convertOpenAIUsage');

export const convertOpenAIUsage = (
  usage: OpenAI.Completions.CompletionUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage => {
  // 目前只有 pplx 才有 citation_tokens
  const inputTextTokens = usage.prompt_tokens;
  const inputCitationTokens = (usage as any).citation_tokens;
  const inputCitationTokensForTotal = inputCitationTokens ?? 0;
  const inputTextTokensForTotal = inputTextTokens ?? 0;
  const totalInputTokens = inputCitationTokensForTotal + inputTextTokensForTotal;

  const cachedTokens =
    (usage as any).prompt_cache_hit_tokens ??
    (usage as any).cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens;

  const inputCacheMissTokens =
    (usage as any).prompt_cache_miss_tokens ??
    (cachedTokens === undefined ? undefined : totalInputTokens - cachedTokens);
  const inputWriteCacheTokens =
    (usage.prompt_tokens_details as { cache_write_tokens?: number } | undefined)
      ?.cache_write_tokens ?? (usage as any).cache_write_tokens;

  const totalOutputTokens = usage.completion_tokens;
  const outputReasoning = usage.completion_tokens_details?.reasoning_tokens;
  const outputAudioTokens = usage.completion_tokens_details?.audio_tokens;
  const outputImageTokens = (usage.completion_tokens_details as any)?.image_tokens;
  const outputReasoningForTotal = outputReasoning ?? 0;
  const outputAudioTokensForTotal = outputAudioTokens ?? 0;
  const outputImageTokensForTotal = outputImageTokens ?? 0;

  // XAI 的 completion_tokens 不包含 reasoning_tokens，需要特殊处理
  const outputTextTokens =
    payload?.provider === 'xai'
      ? totalOutputTokens - outputAudioTokensForTotal
      : totalOutputTokens -
        outputReasoningForTotal -
        outputAudioTokensForTotal -
        outputImageTokensForTotal;
  const totalOutputTokensNormalized =
    payload?.provider === 'xai' ? totalOutputTokens + outputReasoningForTotal : totalOutputTokens;

  const totalTokens = inputCitationTokensForTotal + usage.total_tokens;

  const data = {
    acceptedPredictionTokens: usage.completion_tokens_details?.accepted_prediction_tokens,
    inputAudioTokens: usage.prompt_tokens_details?.audio_tokens,
    inputCacheMissTokens: inputCacheMissTokens,
    inputCachedTokens: cachedTokens,
    inputCitationTokens: inputCitationTokens,
    inputTextTokens: inputTextTokens,
    inputWriteCacheTokens,
    outputAudioTokens: outputAudioTokens,
    outputImageTokens: outputImageTokens,
    outputReasoningTokens: outputReasoning,
    outputTextTokens: outputTextTokens,
    rejectedPredictionTokens: usage.completion_tokens_details?.rejected_prediction_tokens,
    totalInputTokens,
    totalOutputTokens: totalOutputTokensNormalized,
    totalTokens,
  } satisfies ModelTokensUsage;

  const finalData: Partial<ModelTokensUsage> = {};

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      finalData[key as keyof ModelTokensUsage] = value;
    }
  });

  log('convertOpenAIUsage data(completion-api): %O', finalData);

  return withUsageCost(finalData as ModelUsage, payload?.pricing);
};

export const normalizeOpenAIStreamUsage = (usage: ModelUsage): ModelUsage => {
  const normalizedUsage = { ...usage } as Partial<ModelUsage>;
  const optionalTokenKeys: Array<keyof ModelTokensUsage> = [
    'acceptedPredictionTokens',
    'inputAudioTokens',
    'inputCachedTokens',
    'inputWriteCacheTokens',
    'outputAudioTokens',
    'outputImageTokens',
    'outputReasoningTokens',
    'rejectedPredictionTokens',
  ];

  optionalTokenKeys.forEach((key) => {
    if (normalizedUsage[key] === 0) delete normalizedUsage[key];
  });

  return normalizedUsage as ModelUsage;
};

export const convertOpenAIResponseUsage = (
  usage: OpenAI.Responses.ResponseUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage => {
  // 1. Extract and default primary values
  const totalInputTokens = usage.input_tokens;
  const inputCachedTokens =
    usage.input_tokens_details?.cached_tokens ?? (usage as any).cached_tokens;
  const inputWriteCacheTokens =
    (usage.input_tokens_details as { cache_write_tokens?: number } | undefined)
      ?.cache_write_tokens ?? (usage as any).cache_write_tokens;

  const totalOutputTokens = usage.output_tokens;
  const outputReasoningTokens = usage.output_tokens_details?.reasoning_tokens;

  const overallTotalTokens = usage.total_tokens;

  // 2. Calculate derived values
  const inputCacheMissTokens =
    inputCachedTokens === undefined ? undefined : totalInputTokens - inputCachedTokens;

  // For ResponseUsage, inputTextTokens is effectively totalInputTokens as no further breakdown is given.
  const inputTextTokens = totalInputTokens;

  const outputImageTokens = (usage.output_tokens_details as any)?.image_tokens;
  const outputTextTokens =
    totalOutputTokens - (outputReasoningTokens ?? 0) - (outputImageTokens ?? 0);

  // 3. Construct the comprehensive data object (matching ModelTokensUsage structure)
  const data = {
    // Fields from ModelTokensUsage that are not in ResponseUsage will be undefined or 0
    // and potentially filtered out later.
    acceptedPredictionTokens: undefined, // Not in ResponseUsage
    inputAudioTokens: undefined, // Not in ResponseUsage
    inputCacheMissTokens: inputCacheMissTokens,
    inputCachedTokens: inputCachedTokens,
    inputCitationTokens: undefined, // Not in ResponseUsage
    inputTextTokens: inputTextTokens,
    inputWriteCacheTokens,
    outputAudioTokens: undefined, // Not in ResponseUsage
    outputImageTokens: outputImageTokens,
    outputReasoningTokens: outputReasoningTokens,
    outputTextTokens: outputTextTokens,
    rejectedPredictionTokens: undefined, // Not in ResponseUsage
    totalInputTokens: totalInputTokens,
    totalOutputTokens: totalOutputTokens,
    totalTokens: overallTotalTokens,
  } satisfies ModelTokensUsage; // This helps ensure all keys of ModelTokensUsage are considered

  // 4. Preserve measured zeroes while excluding unavailable counters.
  const finalData: Partial<ModelUsage> = {}; // Use Partial for type safety during construction
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      finalData[key as keyof ModelTokensUsage] = value;
    }
  });

  log('convertOpenAIResponseUsage data(response-api): %O', finalData);

  return withUsageCost(finalData as ModelUsage, payload?.pricing); // Cast because we've built it to match
};

export const convertOpenAIImageUsage = (
  usage: OpenAI.Images.ImagesResponse.Usage,
  pricing?: Pricing,
): ModelUsage => {
  const inputTokenDetails = usage.input_tokens_details as
    | OpenAI.Images.ImagesResponse.Usage['input_tokens_details']
    | undefined;
  const imageTokens = inputTokenDetails?.image_tokens;
  // Derive text input when the provider reports image tokens but omits text_tokens. Without
  // this, computeChatCost's textInput falls back to totalInputTokens (which includes the
  // image tokens) while imageInput also bills inputImageTokens — double-counting image input.
  const inputTextTokens =
    inputTokenDetails?.text_tokens ??
    (typeof usage.input_tokens === 'number' && typeof imageTokens === 'number'
      ? Math.max(usage.input_tokens - imageTokens, 0)
      : undefined);
  const data = {
    inputImageTokens: imageTokens,
    inputTextTokens: inputTextTokens,
    outputImageTokens: usage.output_tokens,
    totalInputTokens: usage.input_tokens,
    totalOutputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  } satisfies ModelTokensUsage;

  const availableUsage = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== null),
  ) as ModelUsage;
  const usageForPricing = {
    inputImageTokens: availableUsage.inputImageTokens,
    inputTextTokens: availableUsage.inputTextTokens,
    outputImageTokens: availableUsage.outputImageTokens,
    totalInputTokens: availableUsage.totalInputTokens,
  } satisfies ModelTokensUsage;
  const pricingResult = withUsageCost(usageForPricing as ModelUsage, pricing);

  return pricingResult.cost === undefined
    ? availableUsage
    : { ...availableUsage, cost: pricingResult.cost };
};
