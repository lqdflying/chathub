import { describe, expect, it } from 'vitest';

import { injectModelSettings } from './index';

describe('injectModelSettings', () => {
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

  it('injects only documented Moonshot K2.5 and K2.6 toggles', () => {
    expect(injectModelSettings('moonshot', { id: 'kimi-k2.5', type: 'chat' }).settings).toEqual({
      extendParams: ['enableReasoning'],
    });
    expect(injectModelSettings('moonshot', { id: 'kimi-k2.6', type: 'chat' }).settings).toEqual({
      extendParams: ['enableReasoning', 'moonshotPreservedReasoning'],
    });
  });

  it('does not expose a Moonshot K2.7 forced-thinking toggle', () => {
    const model = injectModelSettings('moonshot', {
      abilities: { functionCall: true, reasoning: true, video: true, vision: true },
      id: 'kimi-k2.7-code',
      type: 'chat',
    });

    expect(model.settings?.extendParams).toBeUndefined();
  });
});
