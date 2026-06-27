import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_MEMORY_ROLLUP_MAX_CHARS_PER_TOPIC,
  ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS,
  ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
  ASSISTANT_MEMORY_TARGET_TOKENS,
  buildAssistantMemoryRollupUserContent,
  capTopicSummaryText,
  chainAssistantMemoryRollup,
} from '../assistantMemoryRollup';

describe('capTopicSummaryText', () => {
  it('truncates long text', () => {
    const s = 'a'.repeat(10);
    expect(capTopicSummaryText(s, 5)).toBe('aaaaa\n…');
  });

  it('returns empty for blank', () => {
    expect(capTopicSummaryText('  ', 100)).toBe('');
  });
});

describe('buildAssistantMemoryRollupUserContent', () => {
  it('skips topics without historySummary', () => {
    const body = buildAssistantMemoryRollupUserContent('old', [
      { historySummary: null, sessionId: 's1', title: 'A' },
      { historySummary: '  ', sessionId: 's2', title: 'B' },
      { historySummary: 'hello', sessionId: 's3', title: 'C' },
    ]);
    expect(body).toContain('hello');
    expect(body).not.toContain('s1');
    expect(body).not.toContain('s2');
  });

  it('uses strict default topic and text caps', () => {
    const topics = Array.from({ length: ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS + 1 }, (_, i) => ({
      historySummary: `summary-${i} ${'x'.repeat(ASSISTANT_MEMORY_ROLLUP_MAX_CHARS_PER_TOPIC + 20)}`,
      sessionId: `s${i}`,
      title: `T${i}`,
    }));

    const body = buildAssistantMemoryRollupUserContent(
      'p'.repeat(ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS + 20),
      topics,
    );

    expect(body).toContain(`p`.repeat(ASSISTANT_MEMORY_ROLLUP_MAX_PRIOR_CHARS));
    expect(body).toContain(`newest first; ${ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS} topics`);
    expect(body).toContain('summary-39');
    expect(body).not.toContain('summary-40');
    expect(body).toContain('…');
  });
});

describe('chainAssistantMemoryRollup', () => {
  it('returns system and user messages', () => {
    const r = chainAssistantMemoryRollup({
      priorAssistantMemory: 'p',
      topics: [{ historySummary: 't', sessionId: 'x', title: 'y' }],
    });
    expect(r.messages).toHaveLength(2);
    expect(r.messages?.[0]?.role).toBe('system');
    expect(r.messages?.[1]?.role).toBe('user');
    expect(r.messages?.[1]?.content).toContain('p');
    expect(r.messages?.[1]?.content).toContain('t');
  });

  it('instructs the model to keep durable memory under the strict target', () => {
    const r = chainAssistantMemoryRollup({
      priorAssistantMemory: '',
      topics: [{ historySummary: 'done task', sessionId: 'x', title: 'y' }],
    });

    const system = r.messages?.[0]?.content;
    expect(system).toContain('durable information');
    expect(system).toContain('completed tasks');
    expect(system).toContain(`${ASSISTANT_MEMORY_TARGET_TOKENS} tokens`);
  });
});
