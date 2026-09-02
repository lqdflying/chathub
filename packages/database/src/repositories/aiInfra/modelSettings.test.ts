import { ModelProvider, OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { injectModelSettings } from './index';

describe('injectModelSettings', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.5'])(
    'locks the OpenAI-compatible context window for %s',
    (modelId) => {
      const model = injectModelSettings(ModelProvider.OpenAICompatible, {
        contextWindowTokens: 1_050_000,
        id: modelId,
        type: 'chat',
      });

      expect(model.contextWindowTokens).toBe(OPENAI_COMPATIBLE_CONTEXT_WINDOW_TOKENS);
    },
  );

  it('does not change native OpenAI or OpenAI-compatible image context metadata', () => {
    expect(
      injectModelSettings(ModelProvider.OpenAI, {
        contextWindowTokens: 1_050_000,
        id: 'gpt-5.5',
        type: 'chat',
      }).contextWindowTokens,
    ).toBe(1_050_000);
    expect(
      injectModelSettings(ModelProvider.OpenAICompatible, {
        id: 'gpt-image-2',
        type: 'image',
      }).contextWindowTokens,
    ).toBeUndefined();
  });

  it('injects DeepSeek V4 reasoning controls for fetched models', () => {
    const model = injectModelSettings('deepseek', {
      abilities: { functionCall: true, reasoning: true },
      id: 'deepseek-v4-pro',
      type: 'chat',
    });

    expect(model.settings).toEqual({
      extendParams: ['enableReasoning', 'reasoningEffort'],
    });
  });

  it('injects MiniMax reasoning_split controls for fetched M-series models', () => {
    const model = injectModelSettings('minimax', {
      abilities: { functionCall: true, reasoning: true, video: true, vision: true },
      id: 'MiniMax-M3',
      type: 'chat',
    });

    expect(model.settings).toEqual({
      extendParams: ['minimaxReasoningSplit'],
    });
  });

  it('injects Xiaomi MiMo enableReasoning for fetched V2.5 models', () => {
    expect(
      injectModelSettings('mimo', {
        abilities: { functionCall: true, reasoning: true },
        id: 'mimo-v2.5-pro',
        type: 'chat',
      }).settings,
    ).toEqual({
      extendParams: ['enableReasoning'],
    });
    expect(
      injectModelSettings('mimo', {
        abilities: { functionCall: true, reasoning: true, video: true, vision: true },
        id: 'mimo-v2.5',
        type: 'chat',
      }).settings,
    ).toEqual({
      extendParams: ['enableReasoning'],
    });
  });

  it('injects only documented Moonshot K2.5 and K2.6 toggles', () => {
    expect(injectModelSettings('moonshot', { id: 'kimi-k2.5', type: 'chat' }).settings).toEqual({
      extendParams: ['enableReasoning'],
    });
    expect(injectModelSettings('moonshot', { id: 'kimi-k2.6', type: 'chat' }).settings).toEqual({
      extendParams: ['enableReasoning', 'moonshotPreservedReasoning'],
    });
  });

  it.each(['kimi-k2.7-code', 'kimi-k3'])(
    'does not expose a Moonshot forced-thinking toggle for %s',
    (modelId) => {
      const model = injectModelSettings('moonshot', {
        abilities: { functionCall: true, reasoning: true, video: true, vision: true },
        id: modelId,
        type: 'chat',
      });

      expect(model.settings?.extendParams).toBeUndefined();
    },
  );

  it.each(['glm-5.3', 'glm-5.3-flash'])(
    'injects GLM-5.3 forced-thinking controls without enableReasoning for %s',
    (modelId) => {
      const model = injectModelSettings('zhipu', {
        abilities: { functionCall: true, reasoning: true },
        id: modelId,
        type: 'chat',
      });

      expect(model.settings).toEqual({
        extendParams: ['zhipuReasoningEffort', 'zhipuPreservedThinking'],
      });
    },
  );

  it('still injects enableReasoning plus effort for fetched glm-5.2', () => {
    const model = injectModelSettings('zhipu', {
      abilities: { functionCall: true, reasoning: true },
      id: 'glm-5.2',
      type: 'chat',
    });

    expect(model.settings).toEqual({
      extendParams: ['enableReasoning', 'zhipuReasoningEffort', 'zhipuPreservedThinking'],
    });
  });
});
