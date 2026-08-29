import { describe, expect, it } from 'vitest';

import { ASSISTANT_MEMORY_NO_CHANGES_SENTINEL } from '../assistantMemoryRollup';
import {
  ASSISTANT_MEMORY_DREAM_MAX_TOPICS,
  buildAssistantMemoryDreamUserContent,
  chainAssistantMemoryDream,
} from '../assistantMemoryDream';

describe('buildAssistantMemoryDreamUserContent', () => {
  it('skips topics without historySummary', () => {
    const body = buildAssistantMemoryDreamUserContent('old', [
      { historySummary: null, sessionId: 's1', title: 'A' },
      { historySummary: '  ', sessionId: 's2', title: 'B' },
      { historySummary: 'hello', sessionId: 's3', title: 'C' },
    ]);
    expect(body).toContain('hello');
    expect(body).not.toContain('s1');
    expect(body).not.toContain('s2');
  });

  it('caps the topic list at the dream limit', () => {
    const topics = Array.from({ length: ASSISTANT_MEMORY_DREAM_MAX_TOPICS + 5 }, (_, i) => ({
      historySummary: `summary-${i}`,
      sessionId: `s${i}`,
      title: `T${i}`,
    }));

    const body = buildAssistantMemoryDreamUserContent('prior', topics);
    expect(body).toContain(`${ASSISTANT_MEMORY_DREAM_MAX_TOPICS} topics`);
    expect(body).toContain('summary-29');
    expect(body).not.toContain('summary-30');
  });

  it('includes the UTC history day in the user content', () => {
    const body = buildAssistantMemoryDreamUserContent(
      'prior',
      [{ historySummary: 'hello', sessionId: 's1', title: 'A' }],
      { historyDate: '2026-08-27' },
    );
    expect(body).toContain('UTC day 2026-08-27');
    expect(body).toContain('Prior dream memory cards');
  });
});

describe('chainAssistantMemoryDream', () => {
  const system = () => {
    const payload = chainAssistantMemoryDream({
      priorAssistantMemory: 'prior memory',
      topics: [{ historySummary: 's', sessionId: 's1', title: 'T' }],
    });
    const systemMessage = payload.messages?.find((m) => m.role === 'system');
    return String(systemMessage?.content ?? '');
  };

  it('frames the pass as style learning, not a recap', () => {
    const prompt = system();
    expect(prompt).toContain('HOW the user works with this assistant');
    expect(prompt).toContain('Communication style');
    expect(prompt).toContain('Tool and workflow habits');
  });

  it('explicitly excludes per-topic recaps and one-off facts', () => {
    const prompt = system();
    expect(prompt).toContain('Per-topic recaps');
    expect(prompt).toContain('one-off questions');
    expect(prompt).toContain('Topic N:');
  });

  it('asks for a new card body only, not a full rewrite', () => {
    const prompt = system();
    expect(prompt).toContain('ONE new dream-memory card');
    expect(prompt).toContain('Do NOT rewrite');
  });

  it('keeps the NO_CHANGES sentinel contract', () => {
    const prompt = system();
    expect(prompt).toContain(ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);
    const payload = chainAssistantMemoryDream({
      priorAssistantMemory: 'prior memory',
      topics: [{ historySummary: 's', sessionId: 's1', title: 'T' }],
    });
    const userMessage = payload.messages?.find((m) => m.role === 'user');
    expect(String(userMessage?.content)).toContain(ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);
  });
});
