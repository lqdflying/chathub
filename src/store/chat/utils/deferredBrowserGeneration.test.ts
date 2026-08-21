import { describe, expect, it } from 'vitest';

import {
  deferredBrowserGenerationLaneKey,
  hasActiveToolCallingStream,
  hasPendingModelContinue,
  isDeferredBrowserLaneAssistant,
  isDeferredLaneProducerAlive,
} from './deferredBrowserGeneration';

describe('deferredBrowserGeneration helpers', () => {
  it('treats an empty tool-calling stream array as idle', () => {
    expect(hasActiveToolCallingStream([])).toBe(false);
    expect(
      isDeferredLaneProducerAlive(
        {
          chatLoadingIds: [],
          messageInToolsCallingIds: [],
          toolCallingStreamIds: { assistant: [] },
        },
        'assistant',
      ),
    ).toBe(false);
  });

  it('detects a missing model continue after tool results', () => {
    expect(
      hasPendingModelContinue(
        [
          { id: 'assistant', role: 'assistant' },
          { id: 'tool-1', parentId: 'assistant', role: 'tool' },
        ],
        'assistant',
      ),
    ).toBe(true);
    expect(
      hasPendingModelContinue(
        [
          { id: 'assistant', role: 'assistant' },
          { id: 'tool-1', parentId: 'assistant', role: 'tool' },
          { id: 'follow-up', parentId: 'tool-1', role: 'assistant' },
        ],
        'assistant',
      ),
    ).toBe(false);
  });

  it('matches a deferred lane by conversation key and assistant id', () => {
    const key = deferredBrowserGenerationLaneKey('session', 'topic', null);
    expect(
      isDeferredBrowserLaneAssistant(
        {
          [key]: {
            assistantMessageId: 'assistant',
            reason: 'unsupported_tool',
            toolName: 'lobe-image-designer',
          },
        },
        'session',
        'topic',
        null,
        'assistant',
      ),
    ).toBe(true);
  });
});
