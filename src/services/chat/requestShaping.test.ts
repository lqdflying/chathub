import { REASONING_BUDGET_TOKEN_ADAPTIVE } from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { buildModelExtendParams, resolveModelSearchConfig } from './requestShaping';

describe('resolveModelSearchConfig', () => {
  it.each([
    {
      expected: {
        enabledSearch: false,
        isModelHasBuiltinSearch: false,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: false,
        useModelSearch: false,
      },
      input: {
        provider: ModelProvider.OpenAI,
        searchMode: 'off' as const,
      },
      name: 'search off',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: true,
        useModelSearch: false,
      },
      input: {
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Zhipu,
        searchMode: 'on' as const,
        useModelBuiltinSearch: false,
      },
      name: 'application search selected',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: false,
        useModelSearch: true,
      },
      input: {
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Zhipu,
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'model-native search selected',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: false,
        useModelSearch: true,
      },
      input: {
        modelSearchImpl: 'internal' as const,
        provider: ModelProvider.Perplexity,
        searchMode: 'auto' as const,
      },
      name: 'internal search selected automatically',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: true,
        useModelSearch: false,
      },
      input: {
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Moonshot,
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'provider-level native search guard',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: true,
        useModelSearch: false,
      },
      input: {
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Mimo,
        providerBaseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'MiMo Token Plan keeps ChatHub search when native toggle is on',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: false,
        useModelSearch: true,
      },
      input: {
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Mimo,
        providerBaseURL: 'https://api.xiaomimimo.com/v1',
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'MiMo pay-as-you-go still uses native search when toggle is on',
    },
    {
      expected: {
        enabledSearch: true,
        isModelHasBuiltinSearch: true,
        isProviderHasBuiltinSearch: false,
        useApplicationBuiltinSearchTool: true,
        useModelSearch: false,
      },
      input: {
        mimoTokenPlanEnv: true,
        modelSearchImpl: 'params' as const,
        provider: ModelProvider.Mimo,
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'MiMo env-only Token Plan keeps ChatHub search',
    },
  ])('resolves $name', ({ expected, input }) => {
    expect(resolveModelSearchConfig(input)).toEqual(expected);
  });
});

describe('buildModelExtendParams', () => {
  it('maps the shared sampling, verbosity, URL, and cache options', () => {
    expect(
      buildModelExtendParams({
        chatConfig: {
          disableContextCaching: true,
          minimaxReasoningSplit: false,
          textVerbosity: 'high',
          thinking: 'enabled',
          thinkingBudget: 0,
          urlContext: true,
        },
        model: 'test-model',
        modelExtendParams: [
          'disableContextCaching',
          'textVerbosity',
          'thinking',
          'thinkingBudget',
          'urlContext',
          'minimaxReasoningSplit',
        ],
        provider: ModelProvider.Minimax,
      }),
    ).toEqual({
      enabledContextCaching: false,
      reasoning_split: false,
      thinking: { type: 'enabled' },
      thinkingBudget: 0,
      urlContext: true,
      verbosity: 'high',
    });
  });

  it('maps Anthropic adaptive thinking identically for browser and worker requests', () => {
    expect(
      buildModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          reasoningBudgetToken: REASONING_BUDGET_TOKEN_ADAPTIVE,
          reasoningEffort: 'medium',
        },
        model: 'claude-sonnet-4-6',
        modelExtendParams: ['enableReasoning'],
        provider: ModelProvider.Anthropic,
      }),
    ).toEqual({
      thinking: { effort: 'medium', type: 'adaptive' },
    });
  });

  it('applies provider-specific reasoning mappings', () => {
    expect(
      buildModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          moonshotPreservedReasoning: true,
          reasoningBudgetToken: 4096,
        },
        model: 'kimi-k2.6',
        modelExtendParams: ['enableReasoning', 'moonshotPreservedReasoning'],
        provider: ModelProvider.Moonshot,
      }),
    ).toEqual({
      thinking: { budget_tokens: 4096, keep: 'all', type: 'enabled' },
    });

    expect(
      buildModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          reasoningEffort: 'low',
        },
        model: 'deepseek-v4',
        modelExtendParams: ['enableReasoning', 'reasoningEffort'],
        provider: ModelProvider.DeepSeek,
      }),
    ).toEqual({
      reasoning_effort: 'max',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    });

    expect(
      buildModelExtendParams({
        chatConfig: {
          enableReasoning: true,
          zhipuPreservedThinking: true,
          zhipuReasoningEffort: 'skip',
        },
        model: 'glm-5.2',
        modelExtendParams: ['enableReasoning', 'zhipuPreservedThinking', 'zhipuReasoningEffort'],
        provider: ModelProvider.Zhipu,
      }),
    ).toEqual({
      reasoning_effort: 'none',
      thinking: {
        budget_tokens: 1024,
        clear_thinking: false,
        type: 'enabled',
      },
    });
  });

  it('enforces the GPT-5 quality floor when no saved effort exists', () => {
    expect(
      buildModelExtendParams({
        chatConfig: {},
        model: 'gpt-5.6-sol',
        modelExtendParams: ['gpt5ReasoningEffort'],
        provider: ModelProvider.OpenAI,
      }),
    ).toEqual({ reasoning_effort: 'high' });
  });

  it('supports preserved thinking for forced-thinking Zhipu models', () => {
    expect(
      buildModelExtendParams({
        chatConfig: { zhipuPreservedThinking: true },
        model: 'glm-4.7',
        modelExtendParams: ['zhipuPreservedThinking'],
        provider: ModelProvider.Zhipu,
      }),
    ).toEqual({
      thinking: {
        budget_tokens: 0,
        clear_thinking: false,
        type: 'enabled',
      },
    });
  });

  it('sends glm-5.3 reasoning_effort without enableReasoning', () => {
    expect(
      buildModelExtendParams({
        chatConfig: { zhipuReasoningEffort: 'low' },
        model: 'glm-5.3',
        modelExtendParams: ['zhipuReasoningEffort', 'zhipuPreservedThinking'],
        provider: ModelProvider.Zhipu,
      }),
    ).toEqual({ reasoning_effort: 'low' });
  });

  it('maps leftover glm-5.3 skip to API low, not none', () => {
    expect(
      buildModelExtendParams({
        chatConfig: { zhipuReasoningEffort: 'skip' },
        model: 'glm-5.3-flash',
        modelExtendParams: ['zhipuReasoningEffort', 'zhipuPreservedThinking'],
        provider: ModelProvider.Zhipu,
      }),
    ).toEqual({ reasoning_effort: 'low' });
  });
});
