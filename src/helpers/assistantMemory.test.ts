import { ASSISTANT_MEMORY_MAX_CHARS } from '@lobechat/prompts';
import { describe, expect, it, vi } from 'vitest';

import {
  appendFixedMemoryEntry,
  appendDreamMemoryEntry,
  capAssistantMemoryByTokensAsync,
  capDreamMemoryDocument,
  deleteDreamMemoryEntry,
  deleteFixedMemoryEntry,
  dreamMemoryTotalCharBudget,
  enforceDreamMemoryRetention,
  formatFixedMemoryEntries,
  hashText,
  hasDreamMemoryEntryForDate,
  normalizeAssistantMemoryText,
  normalizeDreamMemoryDocument,
  parseDreamMemoryEntries,
  parseFixedMemoryEntries,
  renumberFixedMemoryEntries,
  resolveLastDreamStatus,
  serializeDreamMemoryPriorForPrompt,
  updateFixedMemoryEntry,
} from './assistantMemory';

const { encodeAsync } = vi.hoisted(() => ({ encodeAsync: vi.fn() }));

vi.mock('@/utils/tokenizer', () => ({ encodeAsync }));

describe('normalizeAssistantMemoryText', () => {
  it('strips wrapping fences and common assistant-memory preambles', () => {
    const text = normalizeAssistantMemoryText(
      '```markdown\nHere is the updated assistant memory:\n- User prefers concise answers.\n```',
    );

    expect(text).toBe('- User prefers concise answers.');
  });

  it('strips Chinese preambles', () => {
    expect(normalizeAssistantMemoryText('以下是更新后的助手记忆：\n- 用户偏好简洁回答。')).toBe(
      '- 用户偏好简洁回答。',
    );
    expect(normalizeAssistantMemoryText('更新后的记忆：\n- 内容')).toBe('- 内容');
  });

  it('strips Japanese preambles', () => {
    expect(normalizeAssistantMemoryText('更新されたアシスタントメモリ：\n- 内容')).toBe('- 内容');
  });

  it('strips a generic first line labelled as memory output', () => {
    expect(
      normalizeAssistantMemoryText('Sure! Below is the new assistant memory:\n- item one'),
    ).toBe('- item one');
  });

  it('keeps ordinary content that merely mentions memory', () => {
    const text = '- Remember: the assistant memory feature matters to the user.';
    expect(normalizeAssistantMemoryText(text)).toBe(text);
  });

  it('caps long memory at the hard assistant memory character budget', () => {
    const text = normalizeAssistantMemoryText('a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500));

    expect(text.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
  });
});

describe('appendFixedMemoryEntry', () => {
  it('starts at #1 on an empty doc', () => {
    expect(appendFixedMemoryEntry('', 'likes tea')).toEqual({ doc: '#1: likes tea', index: 1 });
    expect(appendFixedMemoryEntry(undefined, 'likes tea')).toEqual({
      doc: '#1: likes tea',
      index: 1,
    });
  });

  it('appends after the highest existing index', () => {
    const { doc, index } = appendFixedMemoryEntry('#1: a\n#2: b', 'c');
    expect(index).toBe(3);
    expect(doc).toBe('#1: a\n#2: b\n#3: c');
  });

  it('survives user deletions and gaps without collisions', () => {
    // user deleted #2; highest is #5
    const { doc, index } = appendFixedMemoryEntry('#1: a\n#5: e', 'f');
    expect(index).toBe(6);
    expect(doc.endsWith('#6: f')).toBe(true);
  });

  it('ignores non-entry lines and inline hashes', () => {
    const base = '## Notes\nsome #3 text mid-line\n#2: real entry';
    const { index } = appendFixedMemoryEntry(base, 'x');
    expect(index).toBe(3);
  });

  it('trims content and doc edges', () => {
    const { doc } = appendFixedMemoryEntry('  #1: a  ', '  spaced  ');
    expect(doc).toBe('#1: a\n#2: spaced');
  });
});

describe('renumberFixedMemoryEntries', () => {
  it('renumbers gapped entries densely by appearance order', () => {
    expect(renumberFixedMemoryEntries('#1: a\n#5: e\n#9: x')).toBe('#1: a\n#2: e\n#3: x');
  });

  it('preserves non-entry lines verbatim and in place', () => {
    const doc = '## Notes\n#2: b\nfree text with #7 inline\n#4: d';
    expect(renumberFixedMemoryEntries(doc)).toBe('## Notes\n#1: b\nfree text with #7 inline\n#2: d');
  });

  it('appending after renumber stays dense', () => {
    const dense = renumberFixedMemoryEntries('#1: a\n#5: e');
    const { doc, index } = appendFixedMemoryEntry(dense, 'c');
    expect(index).toBe(3);
    expect(doc).toBe('#1: a\n#2: e\n#3: c');
  });
});

describe('updateFixedMemoryEntry', () => {
  it('rewrites the verified entry only', () => {
    const outcome = updateFixedMemoryEntry('#1: likes tea\n#2: uses pnpm', 2, 'pnpm', 'uses bun');
    expect(outcome).toEqual({
      doc: '#1: likes tea\n#2: uses bun',
      entry: { content: 'uses bun', index: 2 },
    });
  });

  it('refuses a mismatched entry and returns the current list', () => {
    const outcome = updateFixedMemoryEntry('#1: likes tea', 1, 'coffee', 'x');
    expect(outcome).toEqual({
      entries: [{ content: 'likes tea', index: 1 }],
      error: 'mismatch',
    });
  });

  it('reports not_found for a missing index', () => {
    const outcome = updateFixedMemoryEntry('#1: likes tea', 3, 'tea', 'x');
    expect(outcome).toMatchObject({ error: 'not_found' });
  });
});

describe('deleteFixedMemoryEntry', () => {
  it('removes the verified entry and renumbers the remainder', () => {
    const outcome = deleteFixedMemoryEntry('#1: a\n#2: b\n#3: c', 2, 'b');
    expect(outcome).toEqual({
      doc: '#1: a\n#2: c',
      removed: { content: 'b', index: 2 },
    });
  });

  it('keeps non-entry lines while renumbering', () => {
    const outcome = deleteFixedMemoryEntry('## Notes\n#1: a\n#2: b', 1, 'a');
    expect(outcome).toEqual({
      doc: '## Notes\n#1: b',
      removed: { content: 'a', index: 1 },
    });
  });

  it('refuses on mismatch without modifying anything', () => {
    const outcome = deleteFixedMemoryEntry('#1: a', 1, 'zzz');
    expect(outcome).toMatchObject({ error: 'mismatch' });
  });
});

describe('parse/format fixed memory entries', () => {
  it('parses entries in order and formats capped previews', () => {
    const entries = parseFixedMemoryEntries(`#2: ${'x'.repeat(100)}\n#1: short`);
    expect(entries.map((e) => e.index)).toEqual([2, 1]);
    const formatted = formatFixedMemoryEntries(entries, 10);
    expect(formatted).toBe(`#2: ${'x'.repeat(10)}…\n#1: short`);
  });
});

describe('hashText', () => {
  it('is deterministic and length-sensitive', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('abc')).not.toBe(hashText('abcd'));
    expect(hashText('')).toBe(hashText(''));
  });

  it('handles CJK content', () => {
    expect(hashText('用户偏好简洁')).toBe(hashText('用户偏好简洁'));
    expect(hashText('用户偏好简洁')).not.toBe(hashText('用户偏好详细'));
  });
});

describe('capAssistantMemoryByTokensAsync', () => {
  it('returns the text unchanged when within the token allowance', async () => {
    encodeAsync.mockResolvedValueOnce(700);

    await expect(capAssistantMemoryByTokensAsync('short memory', 800)).resolves.toBe(
      'short memory',
    );
  });

  it('cuts proportionally when over the allowance', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    // first count: way over; second count (after cut): within allowance
    encodeAsync.mockResolvedValueOnce(1600).mockResolvedValueOnce(750);

    const result = await capAssistantMemoryByTokensAsync(text, 800);

    expect(result.length).toBeLessThan(text.length);
    expect(result.length).toBeLessThanOrEqual(Math.floor((text.length * 800) / 1600));
  });

  it('falls back to the character cap when the tokenizer fails', async () => {
    encodeAsync.mockRejectedValueOnce(new Error('worker down'));

    const long = 'a'.repeat(ASSISTANT_MEMORY_MAX_CHARS + 500);
    const result = await capAssistantMemoryByTokensAsync(long, 800);

    expect(result.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
  });

  it('returns empty for blank input without calling the tokenizer', async () => {
    encodeAsync.mockClear();
    await expect(capAssistantMemoryByTokensAsync('   ', 800)).resolves.toBe('');
    expect(encodeAsync).not.toHaveBeenCalled();
  });
});

describe('scheduleTimeToDayjs', () => {
  it('parses valid HH:mm values without customParseFormat', async () => {
    const { dayjsToScheduleTime, scheduleTimeToDayjs } = await import('./assistantMemory');

    expect(scheduleTimeToDayjs('02:00').isValid()).toBe(true);
    expect(scheduleTimeToDayjs('02:00').format('HH:mm')).toBe('02:00');
    expect(scheduleTimeToDayjs('23:59').format('HH:mm')).toBe('23:59');
    expect(dayjsToScheduleTime(scheduleTimeToDayjs('02:00'))).toBe('02:00');
  });

  it('falls back to 02:00 for invalid values', async () => {
    const { scheduleTimeToDayjs } = await import('./assistantMemory');

    expect(scheduleTimeToDayjs('invalid').format('HH:mm')).toBe('02:00');
  });
});

describe('resolveLastDreamStatus', () => {
  it('ignores legacy/manual rollup fields when no dream ever ran', () => {
    // a historical manual Regenerate writes lastRollupAt/lastError only
    const status = resolveLastDreamStatus({
      lastError: { at: '2026-08-01T02:00:00.000Z', attempts: 1, message: 'manual failure' },
      lastRollupAt: '2026-08-01T02:00:00.000Z',
    });

    expect(status).toEqual({ failed: false, ran: false });
    expect(resolveLastDreamStatus(undefined)).toEqual({ failed: false, ran: false });
    expect(resolveLastDreamStatus({})).toEqual({ failed: false, ran: false });
  });

  it('reports a first failed dream attempt at its own time', () => {
    const status = resolveLastDreamStatus({
      lastDreamAt: '2026-08-28T02:00:00.000Z',
      lastDreamStatus: 'failed',
      lastError: { at: '2026-08-28T02:00:00.000Z', attempts: 1, message: 'upstream' },
    });

    expect(status).toEqual({
      at: '2026-08-28T02:00:00.000Z',
      failed: true,
      ran: true,
    });
  });

  it('reports the latest attempt when a failure follows a success', () => {
    // success at T1 wrote lastRollupAt; the later failed attempt moved
    // lastDreamAt to T2 — the pair must stay consistent (T2 + failed)
    const status = resolveLastDreamStatus({
      lastDreamAt: '2026-08-29T02:00:00.000Z',
      lastDreamMarker: '2026-08-28',
      lastDreamStatus: 'failed',
      lastError: { at: '2026-08-29T02:00:00.000Z', attempts: 1, message: 'upstream' },
      lastRollupAt: '2026-08-28T02:00:00.000Z',
    });

    expect(status).toEqual({
      at: '2026-08-29T02:00:00.000Z',
      failed: true,
      ran: true,
    });
  });

  it('reports a successful no-op dream as completed', () => {
    const status = resolveLastDreamStatus({
      lastDreamAt: '2026-08-28T02:00:00.000Z',
      lastDreamMarker: '2026-08-28',
      lastDreamStatus: 'completed',
      lastError: null,
      lastRollupAt: '2026-08-28T02:00:00.000Z',
    });

    expect(status).toEqual({
      at: '2026-08-28T02:00:00.000Z',
      failed: false,
      ran: true,
    });
  });
});

describe('dream memory entries', () => {
  it('wraps legacy blobs and appends dated cards', () => {
    const wrapped = normalizeDreamMemoryDocument('old prose');
    expect(wrapped).toContain('#1 [legacy]:');
    const { doc } = appendDreamMemoryEntry(wrapped, '2026-08-27', '- prefers tables');
    expect(doc).toContain('#2 [2026-08-27]:');
    expect(doc).toContain('prefers tables');
  });

  it('deletes and renumbers dream cards densely', () => {
    const doc = '#1 [2026-08-25]:\na\n#2 [2026-08-26]:\nb\n#3 [2026-08-27]:\nc';
    const outcome = deleteDreamMemoryEntry(doc, 2, 'b');
    expect(outcome).toMatchObject({ doc: '#1 [2026-08-25]:\na\n#2 [2026-08-27]:\nc' });
  });

  it('merges older single-day cards when over the keep limit', () => {
    const doc = [
      '#1 [2026-08-25]:\na',
      '#2 [2026-08-26]:\nb',
      '#3 [2026-08-27]:\nc',
      '#4 [2026-08-28]:\nd',
    ].join('\n');
    const merged = enforceDreamMemoryRetention(doc, 2);
    expect(merged).toContain('[2026-08-25..2026-08-26]');
    expect(merged).toContain('#2 [2026-08-27]');
    expect(merged).toContain('#3 [2026-08-28]');
    expect(merged).not.toContain('#1 [2026-08-25]:');
  });

  it('keeps overflow non-regenerable at the N+1 boundary', () => {
    const doc = [
      '#1 [2026-08-25]:\na',
      '#2 [2026-08-26]:\nb',
      '#3 [2026-08-27]:\nc',
    ].join('\n');
    const merged = enforceDreamMemoryRetention(doc, 2);
    const entries = parseDreamMemoryEntries(merged);
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.regenerable)).toHaveLength(2);
    expect(entries[0]?.dateTag).toBe('2026-08-25..2026-08-25');
    expect(entries[0]?.regenerable).toBe(false);
  });

  it('caps the serialized document to the total char budget', () => {
    const cards = Array.from({ length: 20 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `#${index + 1} [2026-08-${day}]:\nDAY${day}\n${'x'.repeat(3100)}`;
    }).join('\n');
    const capped = enforceDreamMemoryRetention(cards, 14);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(14));
    expect(capped).toContain('[2026-08-20]');
    expect(capped).not.toContain('#1 [2026-08-01]:');
    const entries = parseDreamMemoryEntries(capped);
    const overflow = entries.find((entry) => /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag));
    expect(overflow).toBeDefined();
    expect(overflow?.dateTag).toContain('2026-08-06');
    expect(overflow?.body).toContain('DAY06');
    expect(overflow?.body).not.toContain('DAY01');
    expect(overflow?.regenerable).toBe(false);
  });

  it('caps oversized single-day and legacy cards to the per-card limit', () => {
    const oversized = `#1 [2026-08-27]:\n${'x'.repeat(100_000)}`;
    const capped = capDreamMemoryDocument(oversized, 1);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    expect(parseDreamMemoryEntries(capped)[0]?.body.length).toBeLessThanOrEqual(
      ASSISTANT_MEMORY_MAX_CHARS,
    );

    const legacy = capDreamMemoryDocument(`#1 [legacy]:\n${'y'.repeat(100_000)}`, 14);
    expect(parseDreamMemoryEntries(legacy)[0]?.body.length).toBeLessThanOrEqual(
      ASSISTANT_MEMORY_MAX_CHARS,
    );
  });

  it('preserves custom-tagged structured memory through cap and retention', () => {
    const doc = '#1 [important]:\nkeep me';
    expect(capDreamMemoryDocument(doc, 14)).toContain('keep me');
    expect(enforceDreamMemoryRetention(doc, 14)).toContain('keep me');
  });

  it('does not treat custom tags that contain .. as date ranges', () => {
    const doc = '#1 [important..notes]:\nkeep me';
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capped).toContain('#1 [important..notes]:');
    expect(capped).toContain('keep me');
    expect(capped).not.toContain('[important]');
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    expect(enforceDreamMemoryRetention(doc, 14)).toContain('[important..notes]:');
  });

  it('still expands a genuine YYYY-MM-DD..YYYY-MM-DD overflow card', () => {
    const doc =
      '#1 [2026-08-01..2026-08-03]:\n[2026-08-01]\nold\n\n[2026-08-03]\nnewest-day';
    const capped = capDreamMemoryDocument(doc, 14);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-03');
    expect(overflow?.body).toContain('newest-day');
    expect(overflow?.regenerable).toBe(false);
  });

  it('consolidates multiple range cards and keeps the newest overflow', () => {
    const buildRange = (index: number, month: string, marker: string, count: number) => {
      const parts = Array.from({ length: count }, (_, partIndex) => {
        const day = String(partIndex + 1).padStart(2, '0');
        return `[2026-${month}-${day}]\n${marker}${day}\n${'x'.repeat(80)}`;
      });
      const start = `2026-${month}-01`;
      const end = `2026-${month}-${String(count).padStart(2, '0')}`;
      return `#${index} [${start}..${end}]:\n${parts.join('\n\n')}`;
    };

    const doc = `${buildRange(1, '06', 'A', 90)}\n${buildRange(2, '07', 'B', 90)}`;
    const capped = capDreamMemoryDocument(doc, 1);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    expect(capDreamMemoryDocument(capped, 1)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(overflow).toBeDefined();
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
    expect(overflow?.body).toContain('B90');
    expect(overflow?.body).not.toContain('A01');
    expect(overflow?.dateTag.endsWith('2026-07-90')).toBe(true);
    expect(overflow?.body).toContain(`[${overflow?.dateTag.split('..')[0]}]`);
    expect(overflow?.body).toContain(`[${overflow?.dateTag.split('..')[1]}]`);
  });

  it('caps an oversized merged card body to the per-card limit', () => {
    const parts = Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `[2026-08-${day}]\nDAY${day}\n${'x'.repeat(3000)}`;
    });
    const doc = `#1 [2026-08-01..2026-08-10]:\n${parts.join('\n\n')}`;
    const capped = capDreamMemoryDocument(doc, 14);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);
    expect(overflow?.body).toContain('DAY10');
    expect(overflow?.body).not.toContain('DAY01');
    expect(overflow?.dateTag).toContain('2026-08-10');
  });

  it('terminates and stays in budget for multiple max-sized custom tags', () => {
    const doc = ['alpha', 'beta', 'gamma']
      .map((tag, index) => `#${index + 1} [${tag}]:\n${tag.toUpperCase()}\n${'x'.repeat(3200)}`)
      .join('\n');
    const started = Date.now();
    const capped = capDreamMemoryDocument(doc, 1);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    expect(capped).toContain('GAMMA');
  });

  it('shrinks a later long single-day card when the oldest body is already one character', () => {
    const doc = [
      '#1 [2026-08-01]:\nx',
      `#2 [2026-08-02]:\n${'y'.repeat(20_000)}`,
      `#3 [2026-08-03]:\n${'z'.repeat(20_000)}`,
    ].join('\n');
    const capped = capDreamMemoryDocument(doc, 1);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    expect(capped).toContain('z');
  });

  it('never exceeds the budget for many one-character custom entries', () => {
    const doc = Array.from({ length: 500 }, (_, index) => `#${index + 1} [c${index}]:\nx`).join('\n');
    const capped = capDreamMemoryDocument(doc, 1);
    expect(capped.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
  });

  it('orders prior prompt context with newest single-day cards first', () => {
    const doc = [
      '#1 [2026-08-25]:\nold',
      '#2 [2026-08-27]:\nnew',
    ].join('\n');
    const prior = serializeDreamMemoryPriorForPrompt(doc);
    expect(prior.indexOf('new')).toBeLessThan(prior.indexOf('old'));
  });

  it('detects an existing card for a history date', () => {
    const doc = '#1 [2026-08-27]:\nhello';
    expect(hasDreamMemoryEntryForDate(doc, '2026-08-27')).toBe(true);
    expect(hasDreamMemoryEntryForDate(doc, '2026-08-28')).toBe(false);
  });
});
