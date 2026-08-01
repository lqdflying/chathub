import { describe, expect, it } from 'vitest';

import {
  appendMemoryArchivesToHistorySummary,
  buildHistorySummaryForRequest,
} from './memoryArchivePrompt';

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

  it('drops excerpts already contained in the current summary', () => {
    const text = appendMemoryArchivesToHistorySummary(
      'The user prefers concise answers and works on project X.',
      [
        // prefix snapshot of the same cumulative summary — a near-duplicate
        { at: 0, summaryExcerpt: 'The user prefers concise answers' },
        { at: 1, summaryExcerpt: 'independent detail from an older pass' },
      ],
      true,
    );

    expect(text).toContain('independent detail from an older pass');
    expect(text).not.toContain('### Memory archive (recent snapshots)\n[1970-01-01T00:00:00.000Z]');
    expect(text!.match(/\[1970/g)).toHaveLength(1);
  });

  it('drops excerpts contained in a newer kept excerpt', () => {
    const text = appendMemoryArchivesToHistorySummary(
      'summary',
      [
        { at: 0, summaryExcerpt: 'user likes typescript' },
        { at: 1, summaryExcerpt: 'user likes typescript and rust' },
      ],
      true,
    );

    // the older excerpt is a prefix of the newer one, so only the newer survives
    expect(text!.match(/user likes typescript/g)).toHaveLength(1);
    expect(text).toContain('user likes typescript and rust');
  });

  it('returns the summary untouched when every excerpt is a duplicate', () => {
    const text = appendMemoryArchivesToHistorySummary(
      'full summary text',
      [{ at: 0, summaryExcerpt: 'full summary' }],
      true,
    );

    expect(text).toBe('full summary text');
  });
});

describe('buildHistorySummaryForRequest', () => {
  it('combines topic summary and enabled archives', () => {
    const text = buildHistorySummaryForRequest({
      archives: [
        {
          at: 0,
          summaryExcerpt: 'archive detail',
        },
      ],
      enableCompressHistory: true,
      enableUserMemoryArchive: true,
      topicSummary: 'topic',
    });

    expect(text).toContain('topic');
    expect(text).toContain('archive detail');
  });

  it('returns undefined when compression is disabled', () => {
    const text = buildHistorySummaryForRequest({
      archives: [
        {
          at: 0,
          summaryExcerpt: 'archive detail',
        },
      ],
      enableCompressHistory: false,
      enableUserMemoryArchive: true,
      topicSummary: 'topic',
    });

    expect(text).toBeUndefined();
  });

  it('returns undefined when there is no topic content', () => {
    const text = buildHistorySummaryForRequest({
      enableCompressHistory: true,
      enableUserMemoryArchive: false,
      topicSummary: '   ',
    });

    expect(text).toBeUndefined();
  });
});
