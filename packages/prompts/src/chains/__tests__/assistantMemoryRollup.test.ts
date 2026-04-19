import { describe, expect, it } from 'vitest';

import {
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
});
