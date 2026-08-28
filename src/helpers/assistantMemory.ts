import { ASSISTANT_MEMORY_MAX_CHARS, ASSISTANT_MEMORY_TARGET_TOKENS } from '@lobechat/prompts';
import type { LobeAgentChatConfig } from '@lobechat/types';

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
