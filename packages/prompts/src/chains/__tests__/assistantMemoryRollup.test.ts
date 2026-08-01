import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
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

  it('includes fixed memory as read-only context when provided', () => {
    const body = buildAssistantMemoryRollupUserContent(
      'prior',
      [{ historySummary: 'hello', sessionId: 's1', title: 'A' }],
      { fixedMemory: 'user is vegetarian' },
    );

    expect(body).toContain('## Fixed memory (read-only context');
    expect(body).toContain('user is vegetarian');
    // fixed memory comes before prior memory and topics
    expect(body.indexOf('Fixed memory')).toBeLessThan(body.indexOf('Prior dynamic memory'));
  });

  it('omits the fixed memory section when absent', () => {
    const body = buildAssistantMemoryRollupUserContent('prior', [
      { historySummary: 'hello', sessionId: 's1', title: 'A' },
    ]);

    expect(body).not.toContain('Fixed memory');
  });

  it('uses the incremental header when only changed topics are listed', () => {
    const body = buildAssistantMemoryRollupUserContent(
      'prior',
      [{ historySummary: 'hello', sessionId: 's1', title: 'A' }],
      { incremental: true },
    );

    expect(body).toContain('## Changed topic summaries since the last rollup');
    expect(body).toContain('Keep prior-memory content about unlisted topics.');
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

  it('frames the task as selective extraction, not consolidation', () => {
    const r = chainAssistantMemoryRollup({
      priorAssistantMemory: '',
      topics: [{ historySummary: 'done task', sessionId: 'x', title: 'y' }],
    });

    const system = r.messages?.[0]?.content as string;
    expect(system).toContain('NOT to consolidate');
    expect(system).toContain('Admission test');
    expect(system).toContain('future, unrelated conversation');
    expect(system).toContain('never by topic or conversation');
    expect(system).toContain('"Topic N: ..." structure is forbidden');
    expect(system).toContain('Completed or resolved tasks');
    expect(system).toContain(`${ASSISTANT_MEMORY_TARGET_TOKENS} tokens is a ceiling, not a goal`);
  });

  it('keeps existing entries verbatim unless superseded (anti-drift)', () => {
    const r = chainAssistantMemoryRollup({
      priorAssistantMemory: 'p',
      topics: [{ historySummary: 't', sessionId: 'x', title: 'y' }],
    });

    const system = r.messages?.[0]?.content as string;
    expect(system).toContain('edit it minimally');
    expect(system).toContain('keep existing entries verbatim');
  });

  it('offers the NO_CHANGES sentinel path in both messages', () => {
    const r = chainAssistantMemoryRollup({
      priorAssistantMemory: 'p',
      topics: [{ historySummary: 't', sessionId: 'x', title: 'y' }],
    });

    expect(r.messages?.[0]?.content).toContain(
      `output exactly ${ASSISTANT_MEMORY_NO_CHANGES_SENTINEL}`,
    );
    expect(r.messages?.[1]?.content).toContain(ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);
  });

  it('forbids duplicating fixed memory when provided', () => {
    const r = chainAssistantMemoryRollup({
      fixedMemory: 'fixed',
      priorAssistantMemory: 'p',
      topics: [{ historySummary: 't', sessionId: 'x', title: 'y' }],
    });

    expect(r.messages?.[0]?.content).toContain('never copy, restate, or contradict it');
    expect(r.messages?.[1]?.content).toContain('## Fixed memory');
  });
});
