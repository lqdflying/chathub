import { ASSISTANT_MEMORY_MAX_CHARS, ASSISTANT_MEMORY_TARGET_TOKENS } from '@lobechat/prompts';
import type { AssistantMemoryMeta, LobeAgentChatConfig } from '@lobechat/types';
import dayjs, { type Dayjs } from 'dayjs';

const PREAMBLE_PATTERNS = [
  /^here(?:'s| is)\s+(?:the\s+)?(?:updated\s+)?assistant memory\s*[:：]\s*/i,
  /^the\s+(?:updated\s+)?assistant memory\s+is\s*[:：]\s*/i,
  /^updated assistant memory\s*[:：]\s*/i,
  /^here(?:'s| is)\s+(?:the\s+)?(?:updated\s+)?dynamic memory\s*[:：]\s*/i,
  /^updated dynamic memory\s*[:：]\s*/i,
  /^(?:这是|以下是)?\s*(?:更新后的|最新的)?\s*(?:助手|助理)?(?:记忆|动态记忆)(?:文档|内容)?\s*[:：]\s*/,
  /^(?:更新された|最新の)?\s*(?:アシスタントの?)?(?:メモリ|記憶)\s*[:：]\s*/,
  // generic first line ending with a "... memory:" style label, in any of the known phrasings
  /^[^\n]{0,60}(?:assistant memory|dynamic memory|助手记忆|动态记忆|アシスタントメモリ)[^\n]{0,12}[:：]\s*\n+/i,
];

const stripWrappingFence = (text: string): string =>
  text
    .replace(/^\s*```(?:markdown|md|text)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

const capAtReadableBoundary = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;

  const hard = text.slice(0, maxChars).trimEnd();
  const lineBreak = hard.lastIndexOf('\n');
  if (lineBreak >= Math.floor(maxChars * 0.65)) return hard.slice(0, lineBreak).trimEnd();

  const sentenceBreak = Math.max(hard.lastIndexOf('. '), hard.lastIndexOf('。'));
  if (sentenceBreak >= Math.floor(maxChars * 0.65)) {
    return hard.slice(0, sentenceBreak + 1).trimEnd();
  }

  return hard;
};

export const normalizeAssistantMemoryText = (
  text: string | null | undefined,
  maxChars: number = ASSISTANT_MEMORY_MAX_CHARS,
): string => {
  let next = stripWrappingFence((text ?? '').trim());

  for (const pattern of PREAMBLE_PATTERNS) {
    next = next.replace(pattern, '').trim();
  }

  return capAtReadableBoundary(next, maxChars);
};

/**
 * FNV-1a 32-bit content hash (base36, with a length suffix) used for rollup
 * topic watermarks. Not cryptographic — only change detection.
 */
export const hashText = (text: string): string => {
  let hash = 0x81_1C_9D_C5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.codePointAt(i)!;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
};

/**
 * Append one numbered entry (`#N: …`) to the fixed-memory doc, claude-Projects
 * style. Next index = highest existing `#N:` line + 1, so user edits/deletions
 * never cause collisions.
 */
export const appendFixedMemoryEntry = (
  doc: string | null | undefined,
  content: string,
): { doc: string; index: number } => {
  const base = (doc ?? '').trim();
  let maxIndex = 0;
  for (const match of base.matchAll(/^#(\d+):/gm)) {
    maxIndex = Math.max(maxIndex, Number(match[1]));
  }
  const index = maxIndex + 1;
  const entry = `#${index}: ${content.trim()}`;
  return { doc: base ? `${base}\n${entry}` : entry, index };
};

const FIXED_MEMORY_ENTRY_LINE = /^#(\d+):\s?(.*)$/;

export interface FixedMemoryEntry {
  content: string;
  index: number;
}

export type FixedMemoryMutationError = 'mismatch' | 'not_found';

/** Numbered entries (`#N: …` lines) in order of appearance; other lines are ignored. */
export const parseFixedMemoryEntries = (doc: string | null | undefined): FixedMemoryEntry[] => {
  const entries: FixedMemoryEntry[] = [];
  for (const line of (doc ?? '').split('\n')) {
    const match = FIXED_MEMORY_ENTRY_LINE.exec(line);
    if (match) entries.push({ content: match[2].trim(), index: Number(match[1]) });
  }
  return entries;
};

/**
 * Rewrite entry numbers densely (#1…#N by order of appearance) so deleting `#2`
 * makes `#3` become `#2`. Non-entry lines (headers, free markdown) are preserved
 * verbatim in place.
 */
export const renumberFixedMemoryEntries = (doc: string | null | undefined): string => {
  let next = 0;
  return (doc ?? '')
    .split('\n')
    .map((line) => {
      const match = FIXED_MEMORY_ENTRY_LINE.exec(line);
      if (!match) return line;
      next += 1;
      return `#${next}: ${match[2].trim()}`;
    })
    .join('\n')
    .trim();
};

/** Compact feedback list for tool error results, so the model can self-correct. */
export const formatFixedMemoryEntries = (
  entries: FixedMemoryEntry[],
  capPerEntry = 80,
): string =>
  entries
    .map(
      ({ content, index }) =>
        `#${index}: ${content.length > capPerEntry ? `${content.slice(0, capPerEntry)}…` : content}`,
    )
    .join('\n');

const findEntryLine = (
  lines: string[],
  index: number,
): { content: string; line: number } | undefined => {
  for (const [lineNumber, line] of lines.entries()) {
    const match = FIXED_MEMORY_ENTRY_LINE.exec(line);
    if (match && Number(match[1]) === index) {
      return { content: match[2].trim(), line: lineNumber };
    }
  }
  return undefined;
};

/**
 * Replace the content of entry `#index` after verifying it still contains the
 * `match` snippet — numbers can shift between the memory injection the model
 * saw and the write, so an unverified index must never mutate blindly.
 */
export const updateFixedMemoryEntry = (
  doc: string | null | undefined,
  index: number,
  match: string,
  content: string,
):
  | { doc: string; entry: FixedMemoryEntry }
  | { entries: FixedMemoryEntry[]; error: FixedMemoryMutationError } => {
  const lines = (doc ?? '').split('\n');
  const target = findEntryLine(lines, index);
  if (!target) return { entries: parseFixedMemoryEntries(doc), error: 'not_found' };
  if (!target.content.includes(match.trim())) {
    return { entries: parseFixedMemoryEntries(doc), error: 'mismatch' };
  }

  const nextContent = content.trim();
  lines[target.line] = `#${index}: ${nextContent}`;
  return { doc: lines.join('\n').trim(), entry: { content: nextContent, index } };
};

/**
 * Remove entry `#index` after `match` verification, then renumber the remaining
 * entries densely.
 */
export const deleteFixedMemoryEntry = (
  doc: string | null | undefined,
  index: number,
  match: string,
):
  | { doc: string; removed: FixedMemoryEntry }
  | { entries: FixedMemoryEntry[]; error: FixedMemoryMutationError } => {
  const lines = (doc ?? '').split('\n');
  const target = findEntryLine(lines, index);
  if (!target) return { entries: parseFixedMemoryEntries(doc), error: 'not_found' };
  if (!target.content.includes(match.trim())) {
    return { entries: parseFixedMemoryEntries(doc), error: 'mismatch' };
  }

  lines.splice(target.line, 1);
  return {
    doc: renumberFixedMemoryEntries(lines.join('\n')),
    removed: { content: target.content, index },
  };
};

/** Allow slightly over target before trimming, so borderline outputs are kept intact. */
const TOKEN_CAP_TOLERANCE = 1.15;

/**
 * Cap dynamic memory by tokens instead of characters, so CJK text is held to
 * the same budget as English (the 3200-char cap is ~4x the token target for
 * CJK). Falls back to the character cap when the tokenizer is unavailable.
 */
export const capAssistantMemoryByTokensAsync = async (
  text: string,
  maxTokens: number = ASSISTANT_MEMORY_TARGET_TOKENS,
): Promise<string> => {
  const trimmed = text.trim();
  if (!trimmed) return '';

  try {
    const { encodeAsync } = await import('@/utils/tokenizer');
    const allowance = Math.ceil(maxTokens * TOKEN_CAP_TOLERANCE);

    let current = trimmed;
    let count = await encodeAsync(current);
    if (count <= allowance) return current;

    // proportional cut snapped to a readable boundary, re-checked once
    current = capAtReadableBoundary(
      current,
      Math.max(1, Math.floor((current.length * maxTokens) / count)),
    );
    count = await encodeAsync(current);
    if (count <= allowance) return current;

    return capAtReadableBoundary(current, Math.max(1, Math.floor((current.length * maxTokens) / count)));
  } catch {
    return capAtReadableBoundary(trimmed, ASSISTANT_MEMORY_MAX_CHARS);
  }
};

export type MemoryDreamScheduleFrequency = 'daily' | 'off' | 'weekly';

export interface MemoryDreamSchedule {
  frequency: MemoryDreamScheduleFrequency;
  time: string;
  weekday: number;
}

const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isDreamFrequency = (value: unknown): value is MemoryDreamScheduleFrequency =>
  value === 'off' || value === 'daily' || value === 'weekly';

/**
 * Resolve the dream schedule from chatConfig, including the read-time migration
 * from the deprecated daily-topic-note / periodic-rollup toggles.
 *
 * An explicit `memoryDreamScheduleFrequency` always wins. When it is unset,
 * either legacy toggle maps to `'daily'`. Times are UTC `HH:mm`.
 */
export const resolveMemoryDreamSchedule = (
  chatConfig?: Partial<LobeAgentChatConfig> | null,
): MemoryDreamSchedule => {
  const time = SCHEDULE_TIME_PATTERN.test(chatConfig?.memoryDreamScheduleTime ?? '')
    ? (chatConfig!.memoryDreamScheduleTime as string)
    : '02:00';
  const weekdayRaw = chatConfig?.memoryDreamScheduleWeekday;
  const weekday =
    typeof weekdayRaw === 'number' && Number.isInteger(weekdayRaw) && weekdayRaw >= 0 && weekdayRaw <= 6
      ? weekdayRaw
      : 0;

  if (isDreamFrequency(chatConfig?.memoryDreamScheduleFrequency)) {
    return { frequency: chatConfig.memoryDreamScheduleFrequency, time, weekday };
  }

  if (chatConfig?.enableDailyMemorySummary || chatConfig?.enablePeriodicAssistantMemoryRollup) {
    return { frequency: 'daily', time, weekday };
  }

  return { frequency: 'off', time, weekday };
};

const ROLLUP_BACKOFF_BASE_MS = 10 * 60 * 1000;
const ROLLUP_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

/** Exponential backoff for failed scheduled rollup/dream runs (10 min base, 6 h cap). */
export const rollupBackoffDelayMs = (attempts: number) =>
  Math.min(ROLLUP_BACKOFF_BASE_MS * 2 ** (Math.max(1, attempts) - 1), ROLLUP_BACKOFF_MAX_MS);

/** Parse a validated `HH:mm` schedule string into hour/minute parts. */
export const parseScheduleHHmm = (value: string | undefined) => {
  const match = SCHEDULE_TIME_PATTERN.exec(value ?? '');
  return match
    ? { hour: Number(match[1]), minute: Number(match[2]) }
    : { hour: 2, minute: 0 };
};

/** Build a Dayjs time for Ant Design `TimePicker` without `customParseFormat`. */
export const scheduleTimeToDayjs = (value: string | undefined): Dayjs => {
  const { hour, minute } = parseScheduleHHmm(value);
  return dayjs().hour(hour).minute(minute).second(0).millisecond(0);
};

export const dayjsToScheduleTime = (value: Dayjs | null | undefined): string =>
  value?.format('HH:mm') ?? '02:00';

export interface LastDreamStatus {
  /** ISO timestamp of the latest committed dream attempt. */
  at?: string;
  /** True when the latest committed dream attempt failed (backs off and retries). */
  failed: boolean;
  /** True once any scheduled dream attempt has committed an outcome. */
  ran: boolean;
}

/**
 * Dream-specific status for the settings UI. Reads only `lastDreamAt` /
 * `lastDreamStatus`, which the scheduled dream writes on every committed
 * attempt — legacy/manual rollup fields (`lastRollupAt`, `lastError`) are
 * deliberately ignored so a historical manual Regenerate is never presented
 * as a dream run, and a failed attempt never pairs a stale success time with
 * a failure hint.
 */
export const resolveLastDreamStatus = (meta?: AssistantMemoryMeta | null): LastDreamStatus => {
  const at = meta?.lastDreamAt;
  if (!at) return { failed: false, ran: false };
  return { at, failed: meta?.lastDreamStatus === 'failed', ran: true };
};

/** Default keep-newest-N for dated dream-memory cards. */
export const DEFAULT_MEMORY_DREAM_MAX_ENTRIES = 14;

const MEMORY_DREAM_MAX_ENTRIES_MIN = 1;
const MEMORY_DREAM_MAX_ENTRIES_MAX = 90;

/** Resolve `memoryDreamMaxEntries` from chatConfig (default 14, clamped 1–90). */
export const resolveMemoryDreamMaxEntries = (
  chatConfig?: Partial<LobeAgentChatConfig> | null,
): number => {
  const raw = chatConfig?.memoryDreamMaxEntries;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return DEFAULT_MEMORY_DREAM_MAX_ENTRIES;
  return Math.min(MEMORY_DREAM_MAX_ENTRIES_MAX, Math.max(MEMORY_DREAM_MAX_ENTRIES_MIN, raw));
};

const DREAM_MEMORY_HEADER = /^#(\d+) \[([^\]]+)]:\s*(.*)$/;
const DREAM_SINGLE_DAY_TAG = /^\d{4}-\d{2}-\d{2}$/;

export interface DreamMemoryEntry {
  body: string;
  dateTag: string;
  index: number;
  /** True when `dateTag` is a single UTC day (`YYYY-MM-DD`). */
  regenerable: boolean;
}

export type DreamMemoryMutationError = 'mismatch' | 'not_found';

const isDreamSingleDayTag = (tag: string) => DREAM_SINGLE_DAY_TAG.test(tag);
const DREAM_MERGED_TAG = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;
const isDreamMergedTag = (tag: string) => DREAM_MERGED_TAG.test(tag);

/** Non-scheduled tags such as `[legacy]` or pre-feature custom labels. */
export const isDreamCustomTag = (tag: string) =>
  tag !== 'legacy' && !isDreamMergedTag(tag) && !isDreamSingleDayTag(tag);

/** Numbered dream cards (`#N [date]:` blocks) in document order. */
export const parseDreamMemoryEntries = (doc: string | null | undefined): DreamMemoryEntry[] => {
  const text = (doc ?? '').trim();
  if (!text) return [];

  const entries: DreamMemoryEntry[] = [];
  let current: DreamMemoryEntry | null = null;

  for (const line of text.split('\n')) {
    const match = DREAM_MEMORY_HEADER.exec(line);
    if (match) {
      if (current) entries.push(current);
      const bodyStart = match[3].trim();
      const dateTag = match[2].trim();
      current = {
        body: bodyStart,
        dateTag,
        index: Number(match[1]),
        regenerable: isDreamSingleDayTag(dateTag),
      };
    } else if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  if (current) entries.push({ ...current, body: current.body.trim() });

  return entries;
};

export const serializeDreamMemoryEntries = (entries: DreamMemoryEntry[]): string =>
  entries
    .map((entry) => {
      const header = `#${entry.index} [${entry.dateTag}]:`;
      return entry.body ? `${header}\n${entry.body}` : header;
    })
    .join('\n')
    .trim();

/**
 * Wrap a legacy free-text dynamic memory blob as `#1 [legacy]:` so dated cards can
 * append without losing prior content.
 */
export const normalizeDreamMemoryDocument = (doc: string | null | undefined): string => {
  const trimmed = (doc ?? '').trim();
  if (!trimmed) return '';
  if (parseDreamMemoryEntries(trimmed).length > 0) return trimmed;
  return `#1 [legacy]:\n${trimmed}`;
};

const renumberDreamMemoryEntries = (entries: DreamMemoryEntry[]): DreamMemoryEntry[] =>
  entries.map((entry, i) => ({ ...entry, index: i + 1 }));

export const hasDreamMemoryEntryForDate = (
  doc: string | null | undefined,
  historyDate: string,
): boolean =>
  parseDreamMemoryEntries(doc).some(
    (entry) => entry.regenerable && entry.dateTag === historyDate,
  );

/**
 * Append one dated dream card. `historyDate` must be `YYYY-MM-DD`. Next index =
 * highest existing `#N` + 1.
 */
export const appendDreamMemoryEntry = (
  doc: string | null | undefined,
  historyDate: string,
  body: string,
): { doc: string; entry: DreamMemoryEntry; index: number } => {
  const base = normalizeDreamMemoryDocument(doc);
  let maxIndex = 0;
  for (const match of base.matchAll(/^#(\d+) \[/gm)) {
    maxIndex = Math.max(maxIndex, Number(match[1]));
  }
  const index = maxIndex + 1;
  const entry: DreamMemoryEntry = {
    body: body.trim(),
    dateTag: historyDate,
    index,
    regenerable: true,
  };
  const block = serializeDreamMemoryEntries([entry]);
  return { doc: base ? `${base}\n${block}` : block, entry, index };
};

const findDreamEntry = (
  entries: DreamMemoryEntry[],
  index: number,
): DreamMemoryEntry | undefined => entries.find((entry) => entry.index === index);

/**
 * Replace the body of entry `#index` after verifying `dateTag` and a `match` snippet
 * of the current body (regenerate / manual edit).
 */
export const replaceDreamMemoryEntryBody = (
  doc: string | null | undefined,
  index: number,
  dateTag: string,
  match: string,
  body: string,
):
  | { doc: string; entry: DreamMemoryEntry }
  | { entries: DreamMemoryEntry[]; error: DreamMemoryMutationError } => {
  const entries = parseDreamMemoryEntries(doc);
  const target = findDreamEntry(entries, index);
  if (!target) return { entries, error: 'not_found' };
  if (target.dateTag !== dateTag || !target.body.includes(match.trim())) {
    return { entries, error: 'mismatch' };
  }

  const nextBody = body.trim();
  const nextEntries = entries.map((entry) =>
    entry.index === index ? { ...entry, body: nextBody } : entry,
  );
  return { doc: serializeDreamMemoryEntries(nextEntries), entry: { ...target, body: nextBody } };
};

export const updateDreamMemoryEntry = (
  doc: string | null | undefined,
  index: number,
  match: string,
  body: string,
  dateTag?: string,
):
  | { doc: string; entry: DreamMemoryEntry }
  | { entries: DreamMemoryEntry[]; error: DreamMemoryMutationError } => {
  const entries = parseDreamMemoryEntries(doc);
  const target = findDreamEntry(entries, index);
  if (!target) return { entries, error: 'not_found' };
  if (dateTag && target.dateTag !== dateTag) return { entries, error: 'mismatch' };
  if (!target.body.includes(match.trim())) return { entries, error: 'mismatch' };

  return replaceDreamMemoryEntryBody(doc, index, target.dateTag, match, body);
};

export const deleteDreamMemoryEntry = (
  doc: string | null | undefined,
  index: number,
  match: string,
  dateTag?: string,
):
  | { doc: string; removed: DreamMemoryEntry }
  | { entries: DreamMemoryEntry[]; error: DreamMemoryMutationError } => {
  const entries = parseDreamMemoryEntries(doc);
  const target = findDreamEntry(entries, index);
  if (!target) return { entries, error: 'not_found' };
  if (dateTag && target.dateTag !== dateTag) return { entries, error: 'mismatch' };
  if (!target.body.includes(match.trim())) return { entries, error: 'mismatch' };

  const remaining = entries.filter((entry) => entry.index !== index);
  return {
    doc: serializeDreamMemoryEntries(renumberDreamMemoryEntries(remaining)),
    removed: target,
  };
};

interface MergedDreamPart {
  body: string;
  date: string;
}

/** Canonical overflow section header. Distinct from ordinary `[YYYY-MM-DD]` body lines. */
const mergedPartHeaderLine = (date: string) => `[date:${date}]`;
const CANONICAL_PART_MARKER = /^\[date:(\d{4}-\d{2}-\d{2})]$/;
const LEGACY_PART_MARKER = /^\[(\d{4}-\d{2}-\d{2})]$/;
/** Marker-shaped line, optionally already backslash-stuffed. */
const MARKER_SHAPED_LINE = /^(\\*)(\[(?:date:)?\d{4}-\d{2}-\d{2}])$/;

const splitMergedBodyLines = (text: string): string[] =>
  text.split('\n').map((line) => line.replace(/\r$/, ''));

const escapeMergedPartBody = (body: string): string =>
  splitMergedBodyLines(body)
    .map((line) => (MARKER_SHAPED_LINE.test(line) ? `\\${line}` : line))
    .join('\n');

const unescapeMergedPartBody = (body: string): string =>
  splitMergedBodyLines(body)
    .map((line) => {
      const match = MARKER_SHAPED_LINE.exec(line);
      return match && match[1]!.length > 0 ? line.slice(1) : line;
    })
    .join('\n');

const formatMergedDreamBody = (parts: MergedDreamPart[]): string =>
  parts
    .map(({ body, date }) => {
      const header = mergedPartHeaderLine(date);
      const escaped = escapeMergedPartBody(body);
      return escaped ? `${header}\n${escaped}` : header;
    })
    .join('\n\n')
    .trim();

const parseMergedRangeBounds = (tag: string): { end: string; start: string } => {
  const [start, end] = tag.split('..');
  return { end: end ?? start ?? tag, start: start ?? tag };
};

const consumeMergedPartLines = (
  lines: string[],
  marker: RegExp,
  acceptDate: (date: string) => boolean,
  startDate: string,
): MergedDreamPart[] => {
  const parts: MergedDreamPart[] = [];
  let current: MergedDreamPart | null = null;
  const preamble: string[] = [];

  const flushPreamble = () => {
    const text = preamble.join('\n').trim();
    preamble.length = 0;
    return text;
  };

  for (const line of lines) {
    const match = marker.exec(line);
    if (match && acceptDate(match[1]!)) {
      const headingDate = match[1]!;
      if (current) parts.push({ ...current, body: current.body.trim() });
      const pending = flushPreamble();
      if (pending && headingDate !== startDate && parts.length === 0) {
        parts.push({ body: pending, date: startDate });
        current = { body: '', date: headingDate };
      } else {
        current = { body: pending, date: headingDate };
      }
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    } else {
      preamble.push(line);
    }
  }
  if (current) parts.push({ ...current, body: current.body.trim() });
  const leftover = flushPreamble();
  if (!current && leftover) parts.push({ body: leftover, date: startDate });
  return parts;
};

const countInRangeHeadings = (
  lines: string[],
  marker: RegExp,
  inRange: (date: string) => boolean,
): number =>
  lines.reduce((count, line) => {
    const match = marker.exec(line);
    return match && inRange(match[1]!) ? count + 1 : count;
  }, 0);

/**
 * Pick overflow grammar by native heading count, not first-line order.
 * A leading ordinary `[YYYY-MM-DD]` in a canonical card must not select legacy
 * framing; a later `[date:]` body line in a legacy card must not select canonical.
 */
const chooseMergedOverflowGrammar = (
  lines: string[],
  inRange: (date: string) => boolean,
): 'canonical' | 'legacy' | null => {
  const canonicalHeadings = countInRangeHeadings(lines, CANONICAL_PART_MARKER, inRange);
  const legacyHeadings = countInRangeHeadings(lines, LEGACY_PART_MARKER, inRange);
  if (canonicalHeadings > legacyHeadings) return 'canonical';
  if (legacyHeadings > canonicalHeadings) return 'legacy';
  if (canonicalHeadings > 0) return 'canonical';
  if (legacyHeadings > 0) return 'legacy';
  return null;
};

const expandMergedDreamBody = (entry: DreamMemoryEntry): MergedDreamPart[] => {
  if (!isDreamMergedTag(entry.dateTag)) {
    return [{ body: entry.body, date: entry.dateTag }];
  }

  const { start, end } = parseMergedRangeBounds(entry.dateTag);
  const inRange = (date: string) => date >= start && date <= end;
  const lines = splitMergedBodyLines(entry.body);
  const grammar = chooseMergedOverflowGrammar(lines, inRange);
  const rawParts =
    grammar === 'canonical'
      ? consumeMergedPartLines(lines, CANONICAL_PART_MARKER, inRange, start)
      : grammar === 'legacy'
        ? consumeMergedPartLines(lines, LEGACY_PART_MARKER, inRange, start)
        : [];

  if (rawParts.length === 0 && entry.body.trim()) {
    return [{ body: unescapeMergedPartBody(entry.body.trim()), date: start }];
  }

  return rawParts.map((part) => ({ ...part, body: unescapeMergedPartBody(part.body) }));
};

/** Total serialized dynamic-memory char budget: N single-day cards + one overflow slot. */
export const dreamMemoryTotalCharBudget = (maxEntries: number) =>
  (maxEntries + 1) * ASSISTANT_MEMORY_MAX_CHARS;

const mergedBodyFitsBudget = (parts: MergedDreamPart[], budget: number) =>
  formatMergedDreamBody(parts).length <= budget;

const shrinkNewestMergedPart = (
  parts: MergedDreamPart[],
  budget: number,
): MergedDreamPart[] => {
  const anchor = parts.at(-1);
  if (!anchor) return [];

  const prefixParts = parts.slice(0, -1);
  const withBody = (body: string) => [...prefixParts, { body, date: anchor.date }];
  if (mergedBodyFitsBudget(withBody(anchor.body), budget)) return withBody(anchor.body);
  if (!mergedBodyFitsBudget(withBody(''), budget)) {
    return prefixParts.length > 0 ? shrinkNewestMergedPart([anchor], budget) : [];
  }

  let lo = 0;
  let hi = anchor.body.length;
  let bestLen = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sliced = anchor.body.slice(0, mid);
    if (mergedBodyFitsBudget(withBody(sliced), budget)) {
      bestLen = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const sliced = anchor.body.slice(0, bestLen);
  const readable = capAtReadableBoundary(anchor.body, bestLen);
  const body = mergedBodyFitsBudget(withBody(readable), budget) ? readable : sliced.trimEnd();
  return withBody(body);
};

const trimMergedPartsToBudget = (parts: MergedDreamPart[], budget: number): MergedDreamPart[] => {
  if (parts.length === 0 || budget <= 0) return [];

  let next = [...parts];
  while (next.length > 1 && !mergedBodyFitsBudget(next, budget)) {
    next = next.slice(1);
  }

  if (mergedBodyFitsBudget(next, budget)) return next;
  return shrinkNewestMergedPart(next, budget);
};

const capDreamMemoryEntryBody = (entry: DreamMemoryEntry): DreamMemoryEntry => ({
  ...entry,
  body: capAtReadableBoundary(entry.body, ASSISTANT_MEMORY_MAX_CHARS),
});

const dreamDocumentLength = (entries: DreamMemoryEntry[]) =>
  serializeDreamMemoryEntries(renumberDreamMemoryEntries(entries)).length;

const rebuildMergedEntry = (
  entry: DreamMemoryEntry,
  parts: MergedDreamPart[],
): DreamMemoryEntry | undefined => {
  if (parts.length === 0) return undefined;
  let next = parts;
  let body = formatMergedDreamBody(next);
  if (body.length > ASSISTANT_MEMORY_MAX_CHARS) {
    next = trimMergedPartsToBudget(next, ASSISTANT_MEMORY_MAX_CHARS);
    if (next.length === 0) return undefined;
    body = formatMergedDreamBody(next);
  }
  const rangeStart = next[0]!.date;
  const rangeEnd = next.at(-1)!.date;
  return {
    ...entry,
    body,
    dateTag: `${rangeStart}..${rangeEnd}`,
    regenerable: false,
  };
};

const collectMergedParts = (entries: DreamMemoryEntry[]): MergedDreamPart[] => {
  const parts: MergedDreamPart[] = [];
  for (const entry of entries) {
    parts.push(...expandMergedDreamBody(entry));
  }
  parts.sort((a, b) => a.date.localeCompare(b.date));
  return parts;
};

const buildOverflowCard = (parts: MergedDreamPart[]): DreamMemoryEntry[] => {
  const rebuilt = rebuildMergedEntry(
    { body: '', dateTag: '1970-01-01..1970-01-01', index: 1, regenerable: false },
    parts,
  );
  return rebuilt ? [rebuilt] : [];
};

const overflowBodyBudget = (othersLength: number, budget: number) =>
  Math.max(0, Math.min(ASSISTANT_MEMORY_MAX_CHARS, budget - othersLength - 40));

/**
 * Shrink or drop `bucket[0]` so the assembled document can move toward `budget`.
 * Returns true when this call made progress (smaller body or fewer entries).
 */
const shrinkOrDropOldest = (
  bucket: DreamMemoryEntry[],
  assemble: () => DreamMemoryEntry[],
  budget: number,
): boolean => {
  if (bucket.length === 0) return false;
  const target = bucket[0]!;
  const without = assemble().filter((entry) => entry !== target);

  if (dreamDocumentLength([...without, target]) <= budget) return false;

  const empty = { ...target, body: '' };
  if (dreamDocumentLength([...without, empty]) > budget) {
    bucket.shift();
    return true;
  }

  let lo = 0;
  let hi = target.body.length;
  let fittedBody = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = { ...target, body: target.body.slice(0, mid) };
    if (dreamDocumentLength([...without, candidate]) <= budget) {
      fittedBody = candidate.body;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const nextBody = fittedBody.trimEnd();
  if (nextBody === target.body) {
    bucket.shift();
    return true;
  }

  bucket[0] = { ...target, body: nextBody };
  return true;
};

/**
 * Enforce a hard total serialized budget after retention. Newest single-day cards
 * are preserved first; overflow is trimmed from the oldest folded dates first;
 * custom/legacy cards are reduced before single-day cards. Entry headers count.
 */
export const capDreamMemoryDocument = (
  doc: string | null | undefined,
  maxEntries: number,
): string => {
  const normalized = normalizeDreamMemoryDocument(doc);
  if (!normalized) return '';

  const budget = dreamMemoryTotalCharBudget(maxEntries);
  const parsed = parseDreamMemoryEntries(normalized);
  let custom = parsed.filter((entry) => isDreamCustomTag(entry.dateTag)).map(capDreamMemoryEntryBody);
  let legacy = parsed.filter((entry) => entry.dateTag === 'legacy').map(capDreamMemoryEntryBody);
  let singleDay = parsed.filter((entry) => entry.regenerable).map(capDreamMemoryEntryBody);
  let merged = buildOverflowCard(
    trimMergedPartsToBudget(
      collectMergedParts(parsed.filter((entry) => isDreamMergedTag(entry.dateTag))),
      overflowBodyBudget(dreamDocumentLength([...legacy, ...custom, ...singleDay]), budget),
    ),
  );

  const assemble = () => [...legacy, ...custom, ...merged, ...singleDay];

  let guard = 0;
  const maxIterations = Math.max(parsed.length * 8, 32);
  while (dreamDocumentLength(assemble()) > budget && guard < maxIterations) {
    guard += 1;
    if (shrinkOrDropOldest(custom, assemble, budget)) continue;
    if (shrinkOrDropOldest(legacy, assemble, budget)) continue;
    if (merged.length > 0) {
      const before = merged[0]!;
      const next = buildOverflowCard(
        trimMergedPartsToBudget(
          collectMergedParts(merged),
          overflowBodyBudget(dreamDocumentLength([...legacy, ...custom, ...singleDay]), budget),
        ),
      );
      if (
        next.length !== merged.length ||
        next[0]?.dateTag !== before.dateTag ||
        next[0]?.body !== before.body
      ) {
        merged = next;
        continue;
      }
      merged = [];
      continue;
    }
    if (shrinkOrDropOldest(singleDay, assemble, budget)) continue;
    if (custom.length > 0) {
      custom.shift();
      continue;
    }
    if (legacy.length > 0) {
      legacy.shift();
      continue;
    }
    if (merged.length > 0) {
      merged.shift();
      continue;
    }
    if (singleDay.length > 0) {
      singleDay.shift();
      continue;
    }
    break;
  }

  return serializeDreamMemoryEntries(renumberDreamMemoryEntries(assemble()));
};

/** Prior dream cards for the model prompt — newest single-day cards first, then capped. */
export const serializeDreamMemoryPriorForPrompt = (doc: string | null | undefined): string => {
  const entries = parseDreamMemoryEntries(normalizeDreamMemoryDocument(doc));
  const legacy = entries.filter((entry) => entry.dateTag === 'legacy');
  const custom = entries.filter((entry) => isDreamCustomTag(entry.dateTag));
  const merged = entries.filter((entry) => isDreamMergedTag(entry.dateTag));
  const singleDay = entries
    .filter((entry) => entry.regenerable)
    .sort((a, b) => b.dateTag.localeCompare(a.dateTag));
  const ordered = [...singleDay, ...merged, ...custom, ...legacy];
  const serialized = serializeDreamMemoryEntries(renumberDreamMemoryEntries(ordered));
  return capAtReadableBoundary(serialized, ASSISTANT_MEMORY_MAX_CHARS);
};

/**
 * Keep the newest `maxEntries` single-day cards; fold older single-day cards (and any
 * existing merged card) into one range-tagged card at the front (after legacy).
 */
export const enforceDreamMemoryRetention = (
  doc: string | null | undefined,
  maxEntries: number,
): string => {
  const normalized = normalizeDreamMemoryDocument(doc);
  const entries = parseDreamMemoryEntries(normalized);
  if (entries.length === 0) return '';

  const legacy = entries.filter((entry) => entry.dateTag === 'legacy');
  const custom = entries.filter((entry) => isDreamCustomTag(entry.dateTag));
  const merged = entries.filter((entry) => isDreamMergedTag(entry.dateTag));
  const singleDay = entries
    .filter((entry) => entry.regenerable)
    .sort((a, b) => a.dateTag.localeCompare(b.dateTag));

  if (singleDay.length <= maxEntries) {
    return capDreamMemoryDocument(
      serializeDreamMemoryEntries(renumberDreamMemoryEntries(entries)),
      maxEntries,
    );
  }

  const keep = singleDay.slice(-maxEntries);
  const fold = singleDay.slice(0, singleDay.length - maxEntries);
  const foldedParts: MergedDreamPart[] = [];

  for (const entry of merged) foldedParts.push(...expandMergedDreamBody(entry));
  for (const entry of fold) foldedParts.push({ body: entry.body, date: entry.dateTag });

  foldedParts.sort((a, b) => a.date.localeCompare(b.date));
  const rangeStart = foldedParts[0]!.date;
  const rangeEnd = foldedParts.at(-1)!.date;
  const mergedEntry: DreamMemoryEntry = {
    body: formatMergedDreamBody(foldedParts),
    dateTag: `${rangeStart}..${rangeEnd}`,
    index: 1,
    regenerable: false,
  };

  const next = [...legacy, ...custom, mergedEntry, ...keep];
  return capDreamMemoryDocument(
    serializeDreamMemoryEntries(renumberDreamMemoryEntries(next)),
    maxEntries,
  );
};
