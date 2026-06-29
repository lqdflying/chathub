import { ModelProvider } from 'model-bank';

import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

const defaultBaseURL =
  process.env.OPENAICOMPATIBLE_PROXY_URL?.trim() || 'https://api.openai.com/v1';

export const LobeOpenAICompatibleAI = createOpenAICompatibleRuntime({
  baseURL: defaultBaseURL,
  chatCompletion: {
    handlePayload: (payload) => {
      // Explicit allowlist of fields forwarded to the gateway.
      // Internal routing/feature flags (enabledContextCaching, enabledSearch,
      // provider, responseMode, thinkingBudget, urlContext, reasoning_split) are
      // intentionally stripped so they never leak into the provider request body.
      //
      // `text` (GPT-5 verbosity), `verbosity`, and `truncation` are Responses
      // API fields (see OpenAI API definition). They are only forwarded when
      // the request routes to Responses mode; in Chat Completions mode they
      // would cause rejection on strict OpenAI-compatible gateways.
      const {
        apiMode,
        frequency_penalty,
        max_tokens,
        messages,
        model,
        n,
        presence_penalty,
        reasoning,
        reasoning_effort,
        response_format,
        stop,
        stream,
        temperature,
        text,
        tool_choice,
        tools,
        top_p,
        truncation,
        verbosity,
      } = payload as any;

      const isResponses = apiMode === 'responses';

      const result: Record<string, any> = {
        model,
        stream: stream ?? true,
      };

      // Preserve apiMode for factory-level Responses/Chat routing; the factory
      // strips it before the request reaches the provider.
      if (apiMode !== undefined) result.apiMode = apiMode;

      if (messages !== undefined) result.messages = messages;
      if (temperature !== undefined) result.temperature = temperature;
      if (top_p !== undefined) result.top_p = top_p;
      if (max_tokens !== undefined) result.max_tokens = max_tokens;
      if (frequency_penalty !== undefined) result.frequency_penalty = frequency_penalty;
      if (presence_penalty !== undefined) result.presence_penalty = presence_penalty;
      if (n !== undefined) result.n = n;
      if (stop !== undefined) result.stop = stop;
      if (response_format !== undefined) result.response_format = response_format;
      if (tools !== undefined) result.tools = tools;
      if (tool_choice !== undefined) result.tool_choice = tool_choice;
      if (reasoning_effort !== undefined) result.reasoning_effort = reasoning_effort;
      if (reasoning !== undefined) result.reasoning = reasoning;

      // Responses-API-only fields — sending these to /v1/chat/completions
      // causes rejection on strict OpenAI-compatible gateways.
      if (isResponses) {
        if (text !== undefined) result.text = text;
        if (verbosity !== undefined) result.verbosity = verbosity;
        if (truncation !== undefined) result.truncation = truncation;
      }

      return result as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENAICOMPATIBLE_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    try {
      const modelsPage = (await client.models.list()) as any;
      const modelList: Array<{ id: string }> = modelsPage.data || [];
      return processMultiProviderModelList(modelList, ModelProvider.OpenAICompatible);
    } catch {
      return [];
    }
  },
  provider: ModelProvider.OpenAICompatible,
});
