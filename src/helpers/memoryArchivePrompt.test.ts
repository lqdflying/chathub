import { ASSISTANT_MEMORY_MAX_CHARS } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import {
  appendMemoryArchivesToHistorySummary,
  buildHistorySummaryForRequest,
  combineAssistantMemoryWithTopicSummary,
} from './memoryArchivePrompt';

describe('combineAssistantMemoryWithTopicSummary', () => {
  it('labels assistant memory and current topic summary when both are present', () => {
    const text = combineAssistantMemoryWithTopicSummary(
      'User prefers concise answers.',
      'Current topic is deployment.',
    );

    expect(text).toContain('## Assistant memory');
    expect(text).toContain('User prefers concise answers.');
    expect(text).toContain('## Current topic summary');
    expect(text).toContain('Current topic is deployment.');
  });

  it('caps assistant memory before combining it with the topic summary', () => {
    const text = combineAssistantMemoryWithTopicSummary(
      'a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500),
      'topic',
    );

    expect(text).toBeDefined();
    expect(text!.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS + 80);
    expect(text).toContain('topic');
  });

  it('returns assistant memory only when no topic summary is available', () => {
    expect(combineAssistantMemoryWithTopicSummary('memory', undefined)).toBe('memory');
  });

  it('returns topic summary only when no assistant memory is available', () => {
    expect(combineAssistantMemoryWithTopicSummary(undefined, 'topic')).toBe('topic');
  });
});

describe('appendMemoryArchivesToHistorySummary', () => {
  it('appends recent archive excerpts when enabled', () => {
    const text = appendMemoryArchivesToHistorySummary(
      'summary',
      [
        {
          at: 0,
          summaryExcerpt: 'older detail',
        },
      ],
      true,
    );

    expect(text).toContain('summary');
    expect(text).toContain('### Memory archive (recent snapshots)');
    expect(text).toContain('[1970-01-01T00:00:00.000Z] older detail');
  });

  it('leaves the summary unchanged when archives are disabled', () => {
    const text = appendMemoryArchivesToHistorySummary(
      'summary',
      [
        {
          at: 0,
          summaryExcerpt: 'older detail',
        },
      ],
      false,
    );

    expect(text).toBe('summary');
  });

  it('keeps malformed archive entries without throwing', () => {
    const text = appendMemoryArchivesToHistorySummary(
      undefined,
      [
        {
          at: Number.NaN,
          summaryExcerpt: 'kept detail',
        },
      ],
      true,
    );

    expect(text).toContain('[unknown time] kept detail');
  });
});

describe('buildHistorySummaryForRequest', () => {
  it('combines assistant memory, topic summary, and enabled archives', () => {
    const text = buildHistorySummaryForRequest({
      archives: [
        {
          at: 0,
          summaryExcerpt: 'archive detail',
        },
      ],
      assistantMemory: 'memory',
      enableCompressHistory: true,
      enableUserMemoryArchive: true,
      topicSummary: 'topic',
    });

    expect(text).toContain('## Assistant memory');
    expect(text).toContain('memory');
    expect(text).toContain('## Current topic summary');
    expect(text).toContain('topic');
    expect(text).toContain('archive detail');
  });

  it('omits topic summaries and archives when compression is disabled', () => {
    const text = buildHistorySummaryForRequest({
      archives: [
        {
          at: 0,
          summaryExcerpt: 'archive detail',
        },
      ],
      assistantMemory: 'memory',
      enableCompressHistory: false,
      enableUserMemoryArchive: true,
      topicSummary: 'topic',
    });

    expect(text).toBe('memory');
  });
});
