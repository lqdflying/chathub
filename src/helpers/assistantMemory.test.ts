import { ASSISTANT_MEMORY_MAX_CHARS, ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS } from '@lobechat/prompts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  appendFixedMemoryEntry,
  appendDreamMemoryEntry,
  capAssistantMemoryByTokensAsync,
  capDreamMemoryDocument,
  classifyDreamOverflowEnvelope,
  DREAM_OVERFLOW_OPAQUE_V1_SENTINEL,
  DREAM_OVERFLOW_OPAQUE_V2_SENTINEL,
  DREAM_OVERFLOW_OPAQUE_V3_PREFIX,
  deleteDreamMemoryEntry,
  deleteFixedMemoryEntry,
  dreamMemoryTotalCharBudget,
  enforceDreamMemoryRetention,
  formatFixedMemoryEntries,
  hashText,
  hasDreamMemoryEntryForDate,
  hasDreamOverflowControlMarker,
  hasOpaqueOverflowEnvelope,
  normalizeAssistantMemoryText,
  normalizeDreamMemoryDocument,
  overflowSummaryTextBudget,
  parseDreamMemoryEntries,
  parseFixedMemoryEntries,
  renumberFixedMemoryEntries,
  resolveLastDreamStatus,
  serializeDreamMemoryPriorForPrompt,
  serializeVisibleDreamMemoryDocument,
  updateDreamMemoryEntry,
  updateFixedMemoryEntry,
  visibleDreamMemoryBody,
  wrapOverflowSummaryBody,
} from './assistantMemory';

const { encodeAsync } = vi.hoisted(() => ({ encodeAsync: vi.fn() }));

vi.mock('@/utils/tokenizer', () => ({ encodeAsync }));

const OPAQUE_V3_HEADER_LINE = /^\[overflow:opaque-v3 n=\d+ crc=[\da-f]{8}]$/;

const expectValidatedOpaqueEnvelope = (entry: { body: string; dateTag: string }) => {
  expect(hasOpaqueOverflowEnvelope(entry.body, entry.dateTag)).toBe(true);
  expect(entry.body.startsWith(DREAM_OVERFLOW_OPAQUE_V3_PREFIX)).toBe(true);
  expect(entry.body.split('\n')[0]).toMatch(OPAQUE_V3_HEADER_LINE);
};

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

  it('gives the overflow card a 6400-character slot in the total budget', () => {
    expect(dreamMemoryTotalCharBudget(14)).toBe(
      14 * ASSISTANT_MEMORY_MAX_CHARS + ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS,
    );
    const summary = wrapOverflowSummaryBody('standing preference: tables', '2026-08-01', '2026-08-10');
    expect(summary.startsWith('[overflow:v1]\n')).toBe(true);
    expect(summary).toContain('[date:2026-08-01]');
    expect(summary).toContain('standing preference: tables');
    expect(summary).toContain('[date:2026-08-10]');

    const budget = overflowSummaryTextBudget('2026-08-01', '2026-08-10');
    expect(budget).toBeLessThan(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    const fitted = wrapOverflowSummaryBody('x'.repeat(budget), '2026-08-01', '2026-08-10');
    expect(fitted.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);

    const long = wrapOverflowSummaryBody('x'.repeat(8000), '2026-08-01', '2026-08-10');
    expect(long.length).toBeGreaterThan(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(long).toContain('x'.repeat(8000));
  });

  it('classifies overflow envelope kind without exposing marker text', () => {
    expect(classifyDreamOverflowEnvelope('hello', '2026-08-05')).toBe('none');

    const v1 = wrapOverflowSummaryBody('standing preference: tables', '2026-08-01', '2026-08-03');
    expect(classifyDreamOverflowEnvelope(v1, '2026-08-01..2026-08-03')).toBe('overflow_v1');

    const capped = capDreamMemoryDocument(
      `#1 [2026-08-01..2026-08-03]:\n${'x'.repeat(6600)}\ntail`,
      14,
    );
    const overflow = parseDreamMemoryEntries(capped)[0]!;
    expectValidatedOpaqueEnvelope(overflow);
    expect(classifyDreamOverflowEnvelope(overflow.body, overflow.dateTag)).toBe('opaque_v3');

    expect(
      classifyDreamOverflowEnvelope(
        `${DREAM_OVERFLOW_OPAQUE_V2_SENTINEL}\nhello`,
        '2026-08-01..2026-08-03',
      ),
    ).toBe('opaque_payload');
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
    expect(overflow?.body).toContain('[date:2026-08-01]');
    expect(overflow?.body).toContain('[date:2026-08-03]');
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
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(overflow?.body).toContain('B90');
    expect(overflow?.body).not.toContain('A01');
    expect(overflow?.dateTag.endsWith('2026-07-90')).toBe(true);
    expect(overflow?.body).toContain(`[date:${overflow?.dateTag.split('..')[0]}]`);
    expect(overflow?.body).toContain(`[date:${overflow?.dateTag.split('..')[1]}]`);
  });

  it('does not treat date-shaped body lines as overflow part markers', () => {
    const doc = [
      '#1 [2026-08-01]:\nremember launch date\n[2099-12-31]\nthis is ordinary body text',
      '#2 [2026-08-02]:\nsecond old day',
      '#3 [2026-08-03]:\nnewest keep',
    ].join('\n');
    const retained = enforceDreamMemoryRetention(doc, 1);
    expect(capDreamMemoryDocument(retained, 1)).toBe(retained);
    const overflow = parseDreamMemoryEntries(retained).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    const body = overflow?.body ?? '';
    const firstDay = body.indexOf('[date:2026-08-01]');
    const secondDay = body.indexOf('[date:2026-08-02]');
    const spoof = body.indexOf('\\[2099-12-31]');
    expect(firstDay).toBeGreaterThanOrEqual(0);
    expect(secondDay).toBeGreaterThan(firstDay);
    expect(spoof).toBeGreaterThan(firstDay);
    expect(spoof).toBeLessThan(secondDay);
    expect(body).not.toMatch(/\[date:2099-12-31]/);
    expect(body).toContain('this is ordinary body text');
    expect(body).toContain('second old day');
    expect(retained).toContain('newest keep');
  });

  it('keeps genuine overflow when an older body contains a future date line under a tight cap', () => {
    const doc = [
      `#1 [2026-08-01]:\nremember launch date\n[2099-12-31]\nthis is ordinary body text\n${'a'.repeat(3140)}`,
      `#2 [2026-08-02]:\nsecond old day\n${'b'.repeat(3140)}`,
      '#3 [2026-08-03]:\nnewest keep',
    ].join('\n');
    const retained = enforceDreamMemoryRetention(doc, 1);
    expect(retained.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    expect(capDreamMemoryDocument(retained, 1)).toBe(retained);
    const overflow = parseDreamMemoryEntries(retained).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(overflow?.dateTag).toBe('2026-08-02..2026-08-02');
    expect(overflow?.body).toContain('second old day');
    expect(overflow?.body).toContain('b');
    expect(overflow?.body).not.toContain('remember launch date');
    expect(overflow?.body).not.toMatch(/\[date:2099-12-31]/);
    expect(overflow?.dateTag).not.toContain('2099');
  });

  it('escapes in-range date-shaped lines so they stay in the older day body', () => {
    const doc = [
      '#1 [2026-08-01]:\nnote from day one\n[2026-08-02]\nnot a new day',
      '#2 [2026-08-02]:\nreal day two',
      '#3 [2026-08-03]:\nnewest keep',
    ].join('\n');
    const retained = enforceDreamMemoryRetention(doc, 1);
    const overflow = parseDreamMemoryEntries(retained).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    const body = overflow?.body ?? '';
    const firstDay = body.indexOf('[date:2026-08-01]');
    const realSecond = body.lastIndexOf('[date:2026-08-02]');
    const spoof = body.indexOf('\\[2026-08-02]');
    expect(firstDay).toBeGreaterThanOrEqual(0);
    expect(spoof).toBeGreaterThan(firstDay);
    expect(spoof).toBeLessThan(realSecond);
    expect(body).toContain('not a new day');
    expect(body).toContain('real day two');
  });

  it('does not widen a legacy overflow range when a body line looks like a date', () => {
    const doc =
      '#1 [2026-08-01..2026-08-02]:\n[2026-08-01]\nremember launch date\n[2099-12-31]\nthis is ordinary body text\n\n[2026-08-02]\nsecond old day';
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.body).toContain('[date:2026-08-01]');
    expect(overflow?.body).toContain('\\[2099-12-31]');
    expect(overflow?.body).not.toMatch(/\[date:2099-12-31]/);
    expect(overflow?.body).toContain('second old day');
  });

  it('keeps text prepended before the first overflow heading', () => {
    const originalBody = '[date:2026-08-01]\nday one body\n\n[date:2026-08-02]\nday two body';
    const doc = `#1 [2026-08-01..2026-08-02]:\n${originalBody}`;
    const edited = `USER PREPENDED NOTE\n${originalBody}`;
    const updated = updateDreamMemoryEntry(
      doc,
      1,
      'day one body',
      edited,
      '2026-08-01..2026-08-02',
    );
    expect('doc' in updated).toBe(true);
    if (!('doc' in updated)) return;

    const capped = capDreamMemoryDocument(updated.doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    const body = overflow?.body ?? '';
    const firstDay = body.indexOf('[date:2026-08-01]');
    const note = body.indexOf('USER PREPENDED NOTE');
    const secondDay = body.indexOf('[date:2026-08-02]');
    expect(firstDay).toBeGreaterThanOrEqual(0);
    expect(note).toBeGreaterThan(firstDay);
    expect(note).toBeLessThan(secondDay);
    expect(body).toContain('day one body');
    expect(body).toContain('day two body');
  });

  it('does not switch a legacy overflow grammar because a body line looks canonical', () => {
    const doc =
      '#1 [2026-08-01..2026-08-02]:\n[2026-08-01]\nday one\n[date:2026-08-02]\nordinary line\n\n[2026-08-02]\nday two';
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.body).toContain('day one');
    expect(overflow?.body).toContain('ordinary line');
    expect(overflow?.body).toContain('day two');
    expect(visibleDreamMemoryBody(overflow!)).not.toContain('[overflow:v1]');
  });

  it('caps stuffed overflow bodies to the per-card edit limit', () => {
    const cardBodySchema = z.string().min(1).max(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    const marker = '[2099-12-31]';
    const oneMarkerBody = `${marker}\n${'x'.repeat(3183 - marker.length - 1)}`;
    expect(oneMarkerBody.length).toBe(3183);

    const oneMarkerDoc = [`#1 [2026-08-01]:\n${oneMarkerBody}`, '#2 [2026-08-02]:\nkeep newest'].join(
      '\n',
    );
    const oneMarkerCapped = enforceDreamMemoryRetention(oneMarkerDoc, 1);
    const oneOverflow = parseDreamMemoryEntries(oneMarkerCapped).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(oneOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(cardBodySchema.safeParse(oneOverflow?.body).success).toBe(true);
    expect(oneOverflow?.body).toContain('x');
    expect(oneMarkerCapped).toContain('keep newest');
    expect(capDreamMemoryDocument(oneMarkerCapped, 1)).toBe(oneMarkerCapped);

    const manyMarkers = Array.from({ length: 80 }, () => '[2099-12-31]').join('\n');
    const manyBody = `${manyMarkers}\n${'z'.repeat(2000)}`;
    const manyDoc = [`#1 [2026-08-01]:\n${manyBody}`, '#2 [2026-08-02]:\nkeep newest'].join('\n');
    const manyCapped = enforceDreamMemoryRetention(manyDoc, 1);
    const manyOverflow = parseDreamMemoryEntries(manyCapped).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(manyOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(cardBodySchema.safeParse(manyOverflow?.body).success).toBe(true);
    expect(manyOverflow?.dateTag).toContain('2026-08-01');
    expect(manyCapped).toContain('keep newest');
    expect(capDreamMemoryDocument(manyCapped, 1)).toBe(manyCapped);
  });

  it('does not treat a leading ordinary date line as legacy overflow framing', () => {
    const originalBody =
      '[2026-08-01]\n[date:2026-08-01]\nday one body\n\n[date:2026-08-02]\nday two body';
    const doc = `#1 [2026-08-01..2026-08-02]:\n${originalBody}`;
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    const lines = (overflow?.body ?? '').split('\n');
    expect(lines).toContain('[date:2026-08-01]');
    expect(lines).toContain('[date:2026-08-02]');
    expect(lines).toContain('\\[2026-08-01]');
    expect(overflow?.body).toContain('day one body');
    expect(overflow?.body).toContain('day two body');
    expect(lines.indexOf('\\[2026-08-01]')).toBeGreaterThan(lines.indexOf('[date:2026-08-01]'));
    expect(lines.indexOf('\\[2026-08-01]')).toBeLessThan(lines.indexOf('[date:2026-08-02]'));

    const tightDoc = `#1 [2026-08-01..2026-08-02]:\n[2026-08-01]\n[date:2026-08-01]\n${'x'.repeat(3180)}\n\n[date:2026-08-02]\nREAL NEWEST DAY`;
    const tight = capDreamMemoryDocument(tightDoc, 14);
    expect(capDreamMemoryDocument(tight, 14)).toBe(tight);
    const tightOverflow = parseDreamMemoryEntries(tight)[0];
    expect(tightOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(tightOverflow?.body).toContain('REAL NEWEST DAY');
    expect(tightOverflow?.dateTag).toContain('2026-08-02');
    expect(tightOverflow?.dateTag).not.toBe('2026-08-01..2026-08-01');
  });

  it('does not let extra ordinary date lines outvote canonical overflow headings', () => {
    const originalBody = [
      '[2026-08-01]',
      '[2026-08-02]',
      '[2026-08-01]',
      '[date:2026-08-01]',
      'day one body',
      '',
      '[date:2026-08-02]',
      'day two body',
    ].join('\n');
    const doc = `#1 [2026-08-01..2026-08-02]:\n${originalBody}`;
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.body.startsWith('[overflow:v1]\n')).toBe(true);
    expect(overflow?.body).toContain('day one body');
    expect(overflow?.body).toContain('day two body');
    expect(visibleDreamMemoryBody(overflow!)).not.toContain('[overflow:v1]');

    const tightDoc = `#1 [2026-08-01..2026-08-02]:\n[2026-08-01]\n[2026-08-02]\n[2026-08-01]\n[date:2026-08-01]\n${'x'.repeat(3140)}\n\n[date:2026-08-02]\nREAL NEWEST DAY`;
    const tight = capDreamMemoryDocument(tightDoc, 14);
    expect(capDreamMemoryDocument(tight, 14)).toBe(tight);
    const tightOverflow = parseDreamMemoryEntries(tight)[0];
    expect(tightOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(tightOverflow?.body).toContain('REAL NEWEST DAY');
    expect(tightOverflow?.dateTag).toContain('2026-08-02');
    expect(tightOverflow?.dateTag).not.toBe('2026-08-01..2026-08-01');
  });

  it('keeps the true newest legacy day when day one contains an ordinary [date:start] line', () => {
    const filler = 'x'.repeat(3000);
    const doc = [
      '#1 [2026-08-01..2026-08-02]:',
      '[2026-08-01]',
      '[date:2026-08-01]',
      filler,
      '[2026-08-02]',
      'REAL NEWEST DAY',
    ].join('\n');
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.dateTag).not.toBe('2026-08-01..2026-08-01');
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(overflow?.body).toContain('\\[date:2026-08-01]');
    expect(overflow?.body).toContain('REAL NEWEST DAY');
    expect(visibleDreamMemoryBody(overflow!)).toContain('[date:2026-08-01]');
    expect(visibleDreamMemoryBody(overflow!)).toContain('REAL NEWEST DAY');
  });

  it('does not pick fewer parts when both overflow grammars match a three-day legacy card', () => {
    const doc = [
      '#1 [2026-08-01..2026-08-03]:',
      '[2026-08-01]',
      '[date:2026-08-01]',
      'x'.repeat(3140),
      '[2026-08-02]',
      'REAL NEWEST DAY',
      '[date:2026-08-03]',
      'FALSE TAIL',
      '[2026-08-03]',
      'day three',
    ].join('\n');
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-03');
    expect(overflow?.dateTag).not.toBe('2026-08-03..2026-08-03');
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(overflow?.body).toContain('REAL NEWEST DAY');
    expect(overflow?.body).toContain('FALSE TAIL');
    expect(overflow?.body).toContain('day three');
  });

  it('does not pick fewer parts when both overflow grammars match a three-day canonical card', () => {
    const doc = [
      '#1 [2026-08-01..2026-08-03]:',
      '[date:2026-08-01]',
      '[2026-08-01]',
      'x'.repeat(3140),
      '[date:2026-08-02]',
      'REAL NEWEST DAY',
      '[2026-08-03]',
      'FALSE TAIL',
      '[date:2026-08-03]',
      'day three',
    ].join('\n');
    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-03');
    expect(overflow?.dateTag).not.toBe('2026-08-03..2026-08-03');
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(overflow?.body).toContain('REAL NEWEST DAY');
    expect(overflow?.body).toContain('FALSE TAIL');
    expect(overflow?.body).toContain('day three');
  });

  it('does not move stuffed [date:] content to another day on an unrelated edit', () => {
    const stored = [
      '#1 [2026-08-01..2026-08-02]:',
      '[overflow:v1]',
      '[date:2026-08-01]',
      'day one',
      '',
      '[date:2026-08-02]',
      'REAL NEWEST DAY',
      '\\[date:2026-08-01]',
      'ordinary late note',
    ].join('\n');
    const entry = parseDreamMemoryEntries(stored)[0]!;
    const visible = visibleDreamMemoryBody(entry);
    expect(visible).toContain('\\[date:2026-08-01]');
    expect(visible.indexOf('[date:2026-08-02]')).toBeLessThan(visible.indexOf('\\[date:2026-08-01]'));

    const updated = updateDreamMemoryEntry(
      stored,
      1,
      'ordinary late note',
      `${visible}\nEDIT`,
      '2026-08-01..2026-08-02',
    );
    expect('doc' in updated).toBe(true);
    if (!('doc' in updated)) return;

    const capped = capDreamMemoryDocument(updated.doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    const body = overflow?.body ?? '';
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(body.indexOf('[date:2026-08-01]')).toBeLessThan(body.indexOf('[date:2026-08-02]'));
    expect(body.indexOf('[date:2026-08-02]')).toBeLessThan(body.indexOf('\\[date:2026-08-01]'));
    expect(body).toContain('REAL NEWEST DAY');
    expect(body).toContain('ordinary late note');
    expect(body).toContain('EDIT');
    expect(visibleDreamMemoryBody(overflow!)).toContain('\\[date:2026-08-01]');

    const tightStored = [
      '#1 [2026-08-01..2026-08-02]:',
      '[overflow:v1]',
      '[date:2026-08-01]',
      'x'.repeat(3140),
      '',
      '[date:2026-08-02]',
      'REAL NEWEST DAY',
      '\\[date:2026-08-01]',
      'ordinary late note',
    ].join('\n');
    const tightEntry = parseDreamMemoryEntries(tightStored)[0]!;
    const tightUpdated = updateDreamMemoryEntry(
      tightStored,
      1,
      'ordinary late note',
      `${visibleDreamMemoryBody(tightEntry)}\nEDIT`,
      '2026-08-01..2026-08-02',
    );
    expect('doc' in tightUpdated).toBe(true);
    if (!('doc' in tightUpdated)) return;
    const tight = capDreamMemoryDocument(tightUpdated.doc, 14);
    expect(capDreamMemoryDocument(tight, 14)).toBe(tight);
    const tightOverflow = parseDreamMemoryEntries(tight)[0];
    expect(tightOverflow?.body).toContain('REAL NEWEST DAY');
    expect(tightOverflow?.dateTag).toContain('2026-08-02');
    expect(tightOverflow?.dateTag).not.toBe('2026-08-01..2026-08-01');
  });

  it('keeps a user-authored leading [overflow:v1] line as visible range-card content', () => {
    const stored = [
      '#1 [2026-08-01..2026-08-02]:',
      '[overflow:v1]',
      '[date:2026-08-01]',
      'day one body',
      '',
      '[date:2026-08-02]',
      'day two body',
    ].join('\n');
    const entry = parseDreamMemoryEntries(stored)[0]!;
    const edited = `[overflow:v1]\n${visibleDreamMemoryBody(entry)}`;
    const updated = updateDreamMemoryEntry(
      stored,
      1,
      'day one body',
      edited,
      '2026-08-01..2026-08-02',
    );
    expect('doc' in updated).toBe(true);
    if (!('doc' in updated)) return;

    const capped = capDreamMemoryDocument(updated.doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.body.startsWith('[overflow:v1]\n')).toBe(true);
    expect(overflow?.body).toContain('\\[overflow:v1]');
    const visible = visibleDreamMemoryBody(overflow!);
    expect(visible).toContain('[overflow:v1]');
    expect(visible.split('\n').filter((line) => line === '[overflow:v1]').length).toBe(1);
    expect(serializeVisibleDreamMemoryDocument(capped)).toContain('[overflow:v1]');
    expect(serializeVisibleDreamMemoryDocument(capped)).toContain('day one body');
  });

  it('migrates a pre-sentinel legacy range whose first line is [overflow:v1]', () => {
    const doc = [
      '#1 [2026-08-01..2026-08-02]:',
      '[overflow:v1]',
      '[2026-08-01]',
      'day one',
      '[2026-08-02]',
      'day two',
    ].join('\n');
    const before = parseDreamMemoryEntries(doc)[0]!;
    expect(visibleDreamMemoryBody(before)).toContain('[overflow:v1]');
    expect(visibleDreamMemoryBody(before)).toContain('day one');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain('[overflow:v1]');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain('day one');

    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-02');
    expect(overflow?.body).toContain('\\[overflow:v1]');
    expect(overflow?.body).toContain('day one');
    expect(overflow?.body).toContain('day two');
    const visible = visibleDreamMemoryBody(overflow!);
    expect(visible).toContain('[overflow:v1]');
    expect(visible).toContain('day one');
    expect(visible).toContain('day two');
  });

  it('caps an oversized merged card body to the per-card limit', () => {
    const parts = Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `[2026-08-${day}]\nDAY${day}\n${'x'.repeat(3000)}`;
    });
    const doc = `#1 [2026-08-01..2026-08-10]:\n${parts.join('\n\n')}`;
    const capped = capDreamMemoryDocument(doc, 14);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
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

  it('keeps an opaque overflow tail when folding a new day', () => {
    const filler = 'x'.repeat(6600);
    const opaqueCard = ['#1 [2026-08-01..2026-08-03]:', filler, 'OPAQUE_NEWEST_TAIL'].join('\n');
    const standalone = capDreamMemoryDocument(opaqueCard, 1);
    expect(parseDreamMemoryEntries(standalone)[0]?.dateTag).toBe('2026-08-01..2026-08-03');
    expect(standalone).toContain('OPAQUE_NEWEST_TAIL');
    expect(parseDreamMemoryEntries(standalone)[0]?.body.length).toBeLessThanOrEqual(
      ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS,
    );

    const doc = [opaqueCard, '#2 [2026-08-04]:\nday four to fold', '#3 [2026-08-05]:\nkeep newest day'].join(
      '\n',
    );
    const retained = enforceDreamMemoryRetention(doc, 1);
    expect(enforceDreamMemoryRetention(retained, 1)).toBe(retained);
    expect(capDreamMemoryDocument(retained, 1)).toBe(retained);
    expect(retained.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));

    const entries = parseDreamMemoryEntries(retained);
    const overflow = entries.find((entry) => /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag));
    const keep = entries.find((entry) => entry.dateTag === '2026-08-05');
    expect(keep?.body).toContain('keep newest day');
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-04');
    expect(overflow?.body).toContain('OPAQUE_NEWEST_TAIL');
    expect(overflow?.body).toContain('day four to fold');
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expectValidatedOpaqueEnvelope(overflow!);
    expect(overflow?.body.startsWith('[overflow:v1]\n')).toBe(false);
    expect(visibleDreamMemoryBody(overflow!)).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
    expect(visibleDreamMemoryBody(overflow!)).toContain('OPAQUE_NEWEST_TAIL');
  });

  it.each([
    '[date:2026-08-04]',
    '[2026-08-04]',
    '[overflow:opaque-v1]',
    '[overflow:opaque-v2]',
  ] as const)(
    'keeps an opaque overflow tail when the folded day contains %s',
    (heading) => {
      const filler = 'x'.repeat(6600);
      const opaqueCard = ['#1 [2026-08-01..2026-08-03]:', filler, 'OPAQUE_NEWEST_TAIL'].join('\n');
      const doc = [
        opaqueCard,
        `#2 [2026-08-04]:\n${heading}\nDAY4_CONTENT`,
        '#3 [2026-08-05]:\nkeep newest day',
      ].join('\n');
      const retained = enforceDreamMemoryRetention(doc, 1);
      expect(enforceDreamMemoryRetention(retained, 1)).toBe(retained);
      expect(capDreamMemoryDocument(retained, 1)).toBe(retained);
      expect(retained.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));

      const entries = parseDreamMemoryEntries(retained);
      const overflow = entries.find((entry) =>
        /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
      );
      const keep = entries.find((entry) => entry.dateTag === '2026-08-05');
      expect(keep?.body).toContain('keep newest day');
      expect(overflow?.dateTag).toBe('2026-08-01..2026-08-04');
      expectValidatedOpaqueEnvelope(overflow!);
      expect(overflow?.body).toContain('OPAQUE_NEWEST_TAIL');
      expect(overflow?.body).toContain('DAY4_CONTENT');
      expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
      const visible = visibleDreamMemoryBody(overflow!);
      expect(visible).toContain('OPAQUE_NEWEST_TAIL');
      expect(visible).toContain('DAY4_CONTENT');

      if (
        heading === DREAM_OVERFLOW_OPAQUE_V1_SENTINEL ||
        heading === DREAM_OVERFLOW_OPAQUE_V2_SENTINEL
      ) {
        expect(overflow?.body.split('\n')).toContain(heading);
        expect(visible.split('\n').filter((line) => line === heading)).toHaveLength(1);
        expect(visible).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
        expect(serializeVisibleDreamMemoryDocument(retained).split('\n')).toContain(heading);

        const updated = updateDreamMemoryEntry(
          retained,
          overflow!.index,
          'DAY4_CONTENT',
          visible,
          overflow!.dateTag,
        );
        expect('doc' in updated).toBe(true);
        if (!('doc' in updated)) return;
        const afterSave = capDreamMemoryDocument(updated.doc, 1);
        expect(capDreamMemoryDocument(afterSave, 1)).toBe(afterSave);
        const saved = parseDreamMemoryEntries(afterSave).find((entry) =>
          /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
        );
        expectValidatedOpaqueEnvelope(saved!);
        expect(saved?.body.split('\n')).toContain(heading);
        expect(saved?.body).toContain('DAY4_CONTENT');
        expect(visibleDreamMemoryBody(saved!).split('\n').filter((line) => line === heading)).toHaveLength(1);
        expect(visibleDreamMemoryBody(saved!)).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
      } else {
        expect(overflow?.body).toContain(heading);
        expect(visible).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
      }

      const later = appendDreamMemoryEntry(retained, '2026-08-06', 'later keep day').doc;
      const second = enforceDreamMemoryRetention(later, 1);
      expect(enforceDreamMemoryRetention(second, 1)).toBe(second);
      expect(capDreamMemoryDocument(second, 1)).toBe(second);
      const secondEntries = parseDreamMemoryEntries(second);
      const secondOverflow = secondEntries.find((entry) =>
        /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
      );
      const laterKeep = secondEntries.find((entry) => entry.dateTag === '2026-08-06');
      expect(laterKeep?.body).toContain('later keep day');
      expect(secondOverflow?.dateTag).toBe('2026-08-01..2026-08-05');
      expectValidatedOpaqueEnvelope(secondOverflow!);
      expect(secondOverflow?.body).toContain('OPAQUE_NEWEST_TAIL');
      expect(secondOverflow?.body).toContain('DAY4_CONTENT');
      expect(secondOverflow?.body).toContain('keep newest day');
      expect(secondOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
      if (
        heading === DREAM_OVERFLOW_OPAQUE_V1_SENTINEL ||
        heading === DREAM_OVERFLOW_OPAQUE_V2_SENTINEL
      ) {
        expect(secondOverflow?.body.split('\n')).toContain(heading);
        expect(
          visibleDreamMemoryBody(secondOverflow!)
            .split('\n')
            .filter((line) => line === heading),
        ).toHaveLength(1);
        expect(visibleDreamMemoryBody(secondOverflow!)).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
      }
    },
  );

  it.each([
    DREAM_OVERFLOW_OPAQUE_V1_SENTINEL,
    DREAM_OVERFLOW_OPAQUE_V2_SENTINEL,
  ] as const)('keeps a single-day leading %s line visible until fold', (token) => {
    const doc = `#1 [2026-08-05]:\n${token}\nkeep me`;
    const entry = parseDreamMemoryEntries(doc)[0]!;
    expect(visibleDreamMemoryBody(entry)).toContain(token);
    expect(visibleDreamMemoryBody(entry)).toContain('keep me');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain(token);
  });

  it.each([
    DREAM_OVERFLOW_OPAQUE_V1_SENTINEL,
    DREAM_OVERFLOW_OPAQUE_V2_SENTINEL,
  ] as const)('keeps a mid-body %s payload line after opaque cap', (token) => {
    const filler = 'x'.repeat(6600);
    const doc = ['#1 [2026-08-01..2026-08-03]:', filler, token, 'OPAQUE_NEWEST_TAIL'].join('\n');
    const before = parseDreamMemoryEntries(doc)[0]!;
    expect(hasOpaqueOverflowEnvelope(before.body, before.dateTag)).toBe(false);
    expect(visibleDreamMemoryBody(before)).toContain(token);
    expect(visibleDreamMemoryBody(before)).toContain('OPAQUE_NEWEST_TAIL');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain(token);

    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-03');
    expectValidatedOpaqueEnvelope(overflow!);
    expect(overflow?.body.split('\n')).toContain(token);
    expect(overflow?.body).toContain('OPAQUE_NEWEST_TAIL');
    const visible = visibleDreamMemoryBody(overflow!);
    expect(visible.split('\n').filter((line) => line === token)).toHaveLength(1);
    expect(visible).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
    expect(visible).toContain('OPAQUE_NEWEST_TAIL');
  });

  it.each([
    {
      extra: 'USER_LITERAL_FIRST_LINE',
      label: 'an unversioned merged first-line literal v1',
      token: DREAM_OVERFLOW_OPAQUE_V1_SENTINEL,
    },
    {
      extra: 'OPAQUE_NEWEST_TAIL',
      label: 'an interim v1 opaque envelope',
      token: DREAM_OVERFLOW_OPAQUE_V1_SENTINEL,
    },
    {
      extra: 'USER_LITERAL_FIRST_LINE',
      label: 'an unversioned merged first-line literal v2',
      token: DREAM_OVERFLOW_OPAQUE_V2_SENTINEL,
    },
    {
      extra: 'OPAQUE_NEWEST_TAIL',
      label: 'an interim v2 opaque envelope',
      token: DREAM_OVERFLOW_OPAQUE_V2_SENTINEL,
    },
  ] as const)('preserves $label as payload under checksummed v3 framing', ({ extra, token }) => {
    const doc = ['#1 [2026-08-01..2026-08-03]:', token, extra, 'opaque bytes'].join('\n');
    const before = parseDreamMemoryEntries(doc)[0]!;
    expect(hasOpaqueOverflowEnvelope(before.body, before.dateTag)).toBe(false);
    expect(visibleDreamMemoryBody(before)).toContain(token);
    expect(visibleDreamMemoryBody(before)).toContain(extra);
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain(token);
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain(extra);

    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.dateTag).toBe('2026-08-01..2026-08-03');
    expectValidatedOpaqueEnvelope(overflow!);
    expect(overflow?.body.split('\n')[0]).not.toBe(token);
    expect(overflow?.body.split('\n')).toContain(token);
    expect(overflow?.body).toContain(extra);
    const visible = visibleDreamMemoryBody(overflow!);
    expect(visible.split('\n').filter((line) => line === token)).toHaveLength(1);
    expect(visible).toContain(extra);
    expect(visible).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);

    const updated = updateDreamMemoryEntry(capped, overflow!.index, extra, visible, overflow!.dateTag);
    expect('doc' in updated).toBe(true);
    if (!('doc' in updated)) return;
    const afterSave = capDreamMemoryDocument(updated.doc, 14);
    expect(capDreamMemoryDocument(afterSave, 14)).toBe(afterSave);
    const saved = parseDreamMemoryEntries(afterSave)[0];
    expectValidatedOpaqueEnvelope(saved!);
    expect(saved?.body.split('\n')).toContain(token);
    expect(visibleDreamMemoryBody(saved!).split('\n').filter((line) => line === token)).toHaveLength(1);
    expect(visibleDreamMemoryBody(saved!)).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);

    const withKeep = `${afterSave}\n#2 [2026-08-05]:\nkeep newest day`;
    const later = appendDreamMemoryEntry(withKeep, '2026-08-06', 'later keep day').doc;
    const second = enforceDreamMemoryRetention(later, 1);
    expect(enforceDreamMemoryRetention(second, 1)).toBe(second);
    expect(capDreamMemoryDocument(second, 1)).toBe(second);
    expect(second.length).toBeLessThanOrEqual(dreamMemoryTotalCharBudget(1));
    const secondOverflow = parseDreamMemoryEntries(second).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(secondOverflow?.dateTag).toBe('2026-08-01..2026-08-05');
    expectValidatedOpaqueEnvelope(secondOverflow!);
    expect(secondOverflow?.body.split('\n')).toContain(token);
    expect(secondOverflow?.body).toContain(extra);
    expect(secondOverflow?.body).toContain('keep newest day');
    expect(secondOverflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
    expect(
      visibleDreamMemoryBody(secondOverflow!)
        .split('\n')
        .filter((line) => line === token),
    ).toHaveLength(1);
    expect(visibleDreamMemoryBody(secondOverflow!)).not.toContain(DREAM_OVERFLOW_OPAQUE_V3_PREFIX);
  });

  it.each([
    {
      fakeHeader: '[overflow:opaque-v3 n=5 crc=00000000]',
      label: 'wrong checksum',
      rest: 'hello',
    },
    {
      fakeHeader: '[overflow:opaque-v3 n=999 crc=811c9dc5]',
      label: 'wrong length',
      rest: 'hello',
    },
  ] as const)('treats an invalid opaque-v3 header ($label) as payload, not framing', ({ fakeHeader, rest }) => {
    const doc = ['#1 [2026-08-01..2026-08-03]:', fakeHeader, rest].join('\n');
    const before = parseDreamMemoryEntries(doc)[0]!;
    expect(hasOpaqueOverflowEnvelope(before.body, before.dateTag)).toBe(false);
    expect(visibleDreamMemoryBody(before)).toContain(fakeHeader);
    expect(visibleDreamMemoryBody(before)).toContain(rest);
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain(fakeHeader);

    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expectValidatedOpaqueEnvelope(overflow!);
    expect(overflow?.body.split('\n')[0]).not.toBe(fakeHeader);
    expect(overflow?.body.split('\n')).toContain(fakeHeader);
    expect(overflow?.body).toContain(rest);
    const visible = visibleDreamMemoryBody(overflow!);
    expect(visible.split('\n')[0]).toBe(fakeHeader);
    expect(visible).toContain(rest);
  });

  it('does not treat a literal sentinel plus ordinary [date:] content as control framing', () => {
    const filler = 'x'.repeat(6600);
    const doc = [
      '#1 [2026-08-01..2026-08-03]:',
      '[overflow:v1]',
      '[2026-08-01]',
      'day one',
      '[date:2026-08-01]',
      'ordinary date content',
      filler,
      '[2026-08-03]',
      'REAL NEWEST DAY',
    ].join('\n');
    const before = parseDreamMemoryEntries(doc)[0]!;
    expect(hasDreamOverflowControlMarker(before.body, before.dateTag)).toBe(false);
    expect(visibleDreamMemoryBody(before)).toContain('[overflow:v1]');
    expect(visibleDreamMemoryBody(before)).toContain('REAL NEWEST DAY');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain('[overflow:v1]');
    expect(serializeVisibleDreamMemoryDocument(doc)).toContain('REAL NEWEST DAY');

    const capped = capDreamMemoryDocument(doc, 14);
    expect(capDreamMemoryDocument(capped, 14)).toBe(capped);
    const overflow = parseDreamMemoryEntries(capped)[0];
    expect(overflow?.body).toContain('REAL NEWEST DAY');
    expect(overflow?.dateTag).toContain('2026-08-03');
    expect(overflow?.dateTag).not.toBe('2026-08-01..2026-08-01');
    expect(overflow?.body.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
  });

  it.each(
    [0, 1, 2, 3].flatMap((slashes) =>
      (['[2099-12-31]', '[date:2099-12-31]', '[overflow:v1]', '[overflow:opaque-v1]', '[overflow:opaque-v2]'] as const).map((token) => ({
        slashes,
        token,
      })),
    ),
  )('reversibly stuffs $slashes slashes before $token through fold and save', ({ slashes, token }) => {
    const marker = `${'\\'.repeat(slashes)}${token}`;
    const payload = `payload-${slashes}-${token}`;
    const doc = [`#1 [2026-08-01]:\n${marker}\n${payload}`, '#2 [2026-08-02]:\nkeep newest'].join('\n');
    const retained = enforceDreamMemoryRetention(doc, 1);
    expect(enforceDreamMemoryRetention(retained, 1)).toBe(retained);
    expect(capDreamMemoryDocument(retained, 1)).toBe(retained);

    const overflow = parseDreamMemoryEntries(retained).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(overflow).toBeDefined();
    const storedMarker = `${'\\'.repeat(slashes + 1)}${token}`;
    expect(overflow?.body.split('\n')).toContain(storedMarker);
    expect(overflow?.body).toContain(payload);

    const visible = visibleDreamMemoryBody(overflow!);
    if (token.startsWith('[date:')) {
      expect(visible.split('\n')).toContain(storedMarker);
    } else {
      expect(visible.split('\n')).toContain(marker);
    }
    expect(serializeVisibleDreamMemoryDocument(retained).split('\n')).toEqual(
      expect.arrayContaining(visible.split('\n').filter(Boolean)),
    );

    const updated = updateDreamMemoryEntry(
      retained,
      overflow!.index,
      payload,
      `${visible}\nEDIT`,
      overflow!.dateTag,
    );
    expect('doc' in updated).toBe(true);
    if (!('doc' in updated)) return;
    const afterSave = capDreamMemoryDocument(updated.doc, 1);
    expect(capDreamMemoryDocument(afterSave, 1)).toBe(afterSave);
    const saved = parseDreamMemoryEntries(afterSave).find((entry) =>
      /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(entry.dateTag),
    );
    expect(saved?.body.split('\n')).toContain(storedMarker);
    expect(saved?.body).toContain(payload);
    expect(saved?.body).toContain('EDIT');
  });
});
