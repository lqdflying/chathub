import {
  REASONING_BUDGET_TOKEN_ADAPTIVE,
  supportsAnthropicAdaptiveThinking,
} from '@lobechat/model-runtime';
import type { LobeAgentChatConfig } from '@lobechat/types';
import { resolveGPT5ReasoningEffort } from '@lobechat/types';
import type { ExtendParamsType, ModelSearchImplementType } from 'model-bank';
import { ModelProvider } from 'model-bank';

import { isModelNativeSearchDisabledProvider } from '@/helpers/modelNativeSearch';

const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

const isAnthropicRuntimeProvider = (provider?: string) =>
  provider === ModelProvider.Anthropic || provider === ModelProvider.AnthropicCompatible;

export interface ModelSearchConfig {
  enabledSearch: boolean;
  isModelHasBuiltinSearch: boolean;
  isProviderHasBuiltinSearch: boolean;
  useApplicationBuiltinSearchTool: boolean;
  useModelSearch: boolean;
}

export const resolveModelSearchConfig = ({
  modelSearchImpl,
  provider,
  providerBaseURL,
  providerHasBuiltinSearch = false,
  searchMode,
  useModelBuiltinSearch,
}: {
  modelSearchImpl?: ModelSearchImplementType;
  provider: string;
  providerBaseURL?: string;
  providerHasBuiltinSearch?: boolean;
  searchMode?: LobeAgentChatConfig['searchMode'];
  useModelBuiltinSearch?: boolean;
}): ModelSearchConfig => {
  const enabledSearch = searchMode !== 'off';
  const isModelHasBuiltinSearch = Boolean(modelSearchImpl);
  const modelNativeSearchDisabled = isModelNativeSearchDisabledProvider(provider, providerBaseURL);
  const useModelSearch = modelNativeSearchDisabled
    ? false
    : (((providerHasBuiltinSearch || isModelHasBuiltinSearch) && useModelBuiltinSearch) ||
        modelSearchImpl === 'internal' ||
        false);

  return {
    enabledSearch,
    isModelHasBuiltinSearch,
    isProviderHasBuiltinSearch: providerHasBuiltinSearch,
    useApplicationBuiltinSearchTool: enabledSearch && !useModelSearch,
    useModelSearch,
  };
};

export const buildModelExtendParams = ({
  chatConfig,
  model,
  modelExtendParams,
  provider,
}: {
  chatConfig?: Partial<LobeAgentChatConfig>;
  model: string;
  modelExtendParams?: readonly ExtendParamsType[];
  provider: string;
}): Record<string, unknown> => {
  const extendParams: Record<string, unknown> = {};
  if (!chatConfig || !modelExtendParams?.length) return extendParams;

  if (modelExtendParams.includes('enableReasoning')) {
    if (chatConfig.enableReasoning) {
      if (
        isAnthropicRuntimeProvider(provider) &&
        chatConfig.reasoningBudgetToken === REASONING_BUDGET_TOKEN_ADAPTIVE &&
        supportsAnthropicAdaptiveThinking(model)
      ) {
        extendParams.thinking = {
          effort: VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort || '')
            ? chatConfig.reasoningEffort
            : 'high',
          type: 'adaptive',
        };
      } else {
        extendParams.thinking = {
          budget_tokens: chatConfig.reasoningBudgetToken || 1024,
          type: 'enabled',
          ...(model === 'kimi-k2.6' && chatConfig.moonshotPreservedReasoning
            ? { keep: 'all' as const }
            : {}),
          ...(provider === ModelProvider.Zhipu && chatConfig.zhipuPreservedThinking
            ? { clear_thinking: false as const }
            : {}),
        };
      }
    } else {
      extendParams.thinking = {
        budget_tokens: 0,
        type: 'disabled',
      };
    }
  } else if (
    provider === ModelProvider.Zhipu &&
    modelExtendParams.includes('zhipuPreservedThinking') &&
    chatConfig.zhipuPreservedThinking
  ) {
    extendParams.thinking = {
      budget_tokens: 0,
      clear_thinking: false,
      type: 'enabled',
    };
  } else if (modelExtendParams.includes('reasoningBudgetToken')) {
    if (
      isAnthropicRuntimeProvider(provider) &&
      chatConfig.reasoningBudgetToken === REASONING_BUDGET_TOKEN_ADAPTIVE &&
      supportsAnthropicAdaptiveThinking(model)
    ) {
      extendParams.thinking = {
        effort: VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort || '')
          ? chatConfig.reasoningEffort
          : 'high',
        type: 'adaptive',
      };
    } else {
      extendParams.thinking = {
        budget_tokens: chatConfig.reasoningBudgetToken || 1024,
        type: 'enabled',
      };
    }
  }

  if (modelExtendParams.includes('disableContextCaching') && chatConfig.disableContextCaching) {
    extendParams.enabledContextCaching = false;
  }

  if (
    modelExtendParams.includes('reasoningEffort') &&
    (chatConfig.reasoningEffort || chatConfig.enableReasoningEffort)
  ) {
    if (provider === ModelProvider.DeepSeek) {
      if (chatConfig.enableReasoning) extendParams.reasoning_effort = 'max';
    } else {
      extendParams.reasoning_effort = VALID_REASONING_EFFORTS.has(
        chatConfig.reasoningEffort || '',
      )
        ? chatConfig.reasoningEffort
        : undefined;
    }
  }

  if (modelExtendParams.includes('gpt5ReasoningEffort')) {
    const { effort, effortValues } = resolveGPT5ReasoningEffort(
      model,
      chatConfig.gpt5ReasoningEffort,
    );
    if (chatConfig.gpt5ReasoningEffort || effortValues[0] === 'high') {
      extendParams.reasoning_effort = effort;
    }
  }

  if (modelExtendParams.includes('textVerbosity') && chatConfig.textVerbosity) {
    extendParams.verbosity = chatConfig.textVerbosity;
  }

  if (modelExtendParams.includes('thinking') && chatConfig.thinking) {
    extendParams.thinking = { type: chatConfig.thinking };
  }

  if (
    modelExtendParams.includes('thinkingBudget') &&
    chatConfig.thinkingBudget !== undefined
  ) {
    extendParams.thinkingBudget = chatConfig.thinkingBudget;
  }

  if (modelExtendParams.includes('urlContext') && chatConfig.urlContext) {
    extendParams.urlContext = chatConfig.urlContext;
  }

  if (modelExtendParams.includes('minimaxReasoningSplit')) {
    extendParams.reasoning_split = chatConfig.minimaxReasoningSplit !== false;
  }

  if (
    modelExtendParams.includes('zhipuReasoningEffort') &&
    chatConfig.enableReasoning &&
    chatConfig.zhipuReasoningEffort
  ) {
    extendParams.reasoning_effort =
      chatConfig.zhipuReasoningEffort === 'skip' ? 'none' : chatConfig.zhipuReasoningEffort;
  }

  return extendParams;
};
