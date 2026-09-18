import {
  ASSISTANT_MEMORY_MAX_CHARS,
  ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS,
  ASSISTANT_MEMORY_TARGET_TOKENS,
} from '@lobechat/prompts';
import type { AssistantMemoryMeta, LobeAgentChatConfig, MemoryEntryOrigin } from '@lobechat/types';
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
/**
 * Fixed entries are single-line by contract ("one concise fact per entry").
 * Collapse embedded newlines/whitespace runs so a model-authored entry can
 * never smuggle continuation lines past provenance partitioning (F3): origin
 * tags key on the entry's first line, so stored multiline entries would leak
 * their tail into the trusted block.
 */
const normalizeFixedEntryContent = (content: string): string =>
  content.trim().replaceAll(/\s+/g, ' ');

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
  const entry = `#${index}: ${normalizeFixedEntryContent(content)}`;
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

const MEMORY_TOOL_IDENTIFIER = 'lobe-memory';

type MemoryToolMessageLike = {
  content?: string | null;
  id?: string;
  plugin?: { identifier?: string } | null;
  role?: string;
};

const parseMemoryToolResult = (
  content: string | null | undefined,
): Record<string, unknown> | undefined => {
  if (typeof content !== 'string' || !content.trim()) return;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    return parsed as Record<string, unknown>;
  } catch {
    return;
  }
};

/** True when a tool message is a successful lobe-memory save/update/delete. */
export const isSuccessfulMemoryToolResult = (message: MemoryToolMessageLike): boolean => {
  if (message.role !== 'tool') return false;
  if (message.plugin?.identifier !== MEMORY_TOOL_IDENTIFIER) return false;
  const result = parseMemoryToolResult(message.content);
  if (!result) return false;
  return Boolean(result.saved || result.updated || result.deleted);
};

/**
 * Durable Graphile writes `agents.fixed_memory` without touching the client
 * agent-config SWR cache. Detect newly arrived (or rewritten) successful
 * memory-tool results so the settings panel can refetch.
 */
export const hasNewSuccessfulMemoryToolResult = (
  previous: MemoryToolMessageLike[],
  next: MemoryToolMessageLike[],
): boolean => {
  const previousById = new Map(previous.map((message) => [message.id, message]));
  return next.some((message) => {
    if (!isSuccessfulMemoryToolResult(message)) return false;
    const prior = previousById.get(message.id);
    return !prior || prior.content !== message.content;
  });
};

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

  const nextContent = normalizeFixedEntryContent(content);
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

// --- Lexical memory search + dream-card dedupe (M1/M3) ---

const LATIN_WORD_RUN = /[\da-z]+/g;
// CJK unified ideographs (+ ext A, compat), Japanese kana, Korean syllables
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]+/g;

/**
 * CJK-aware lexical tokenizer shared by memory search scoring and dream-card
 * dedupe. Latin/digit runs become lowercase word unigrams; CJK runs become
 * character bigrams (a lone CJK char stays a unigram) so Chinese/Japanese
 * text overlaps meaningfully without word segmentation.
 */
export const tokenizeMemoryText = (text: string): Set<string> => {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  for (const match of lower.matchAll(LATIN_WORD_RUN)) tokens.add(match[0]);

  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }

  return tokens;
};

/** Jaccard similarity over token sets; 0 when both are empty. */
export const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
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

const isDreamSingleDayTag = (tag: string) => DREAM_SINGLE_DAY_TAG.test(tag);

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

/** Near-duplicate threshold for dream-card append (Jaccard over CJK-aware tokens). */
export const DREAM_CARD_DEDUPE_THRESHOLD = 0.8;

/**
 * Return the existing dream card whose body is a near-duplicate of `body`
 * (highest similarity wins), so the dream append path can skip instead of
 * accumulating paraphrase duplicates of the same day summary.
 */
export const findNearDuplicateDreamCard = (
  doc: string | null | undefined,
  body: string,
  threshold: number = DREAM_CARD_DEDUPE_THRESHOLD,
): DreamMemoryEntry | undefined => {
  const bodyTokens = tokenizeMemoryText(body);
  if (bodyTokens.size === 0) return undefined;

  let best: { entry: DreamMemoryEntry; score: number } | undefined;
  for (const entry of parseDreamMemoryEntries(doc)) {
    const score = jaccardSimilarity(bodyTokens, tokenizeMemoryText(entry.body));
    if (score >= threshold && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry;
};

export interface MemorySearchHit {
  /** Card text (capped), as the model would read it. */
  content: string;
  /** Entry number within its tier (`#N`). */
  index: number;
  /** Query-token coverage in [0, 1]. */
  score: number;
  source: 'dynamic' | 'fixed';
}

const SEARCH_SNIPPET_MAX_CHARS = 500;

/** Lead-in kept before the first match so a mid-entry match stays readable. */
const SEARCH_SNIPPET_MATCH_LEAD_IN_CHARS = 80;

/**
 * Snippet window for one hit. Head-anchored when the content fits or the match
 * is early; otherwise anchored on the first verbatim query occurrence so the
 * matched context is actually visible (a head-only window can omit the match
 * entirely for long entries — F7). `readMemory` with the hit's source+index
 * returns the complete entry.
 */
const buildSearchSnippet = (content: string, query: string): string => {
  if (content.length <= SEARCH_SNIPPET_MAX_CHARS) return content;
  const matchIndex = content.toLowerCase().indexOf(query.trim().toLowerCase());
  if (matchIndex < SEARCH_SNIPPET_MAX_CHARS) {
    return `${content.slice(0, SEARCH_SNIPPET_MAX_CHARS)}…`;
  }
  const start = Math.max(0, matchIndex - SEARCH_SNIPPET_MATCH_LEAD_IN_CHARS);
  const window = content.slice(start, start + SEARCH_SNIPPET_MAX_CHARS);
  const suffix = start + SEARCH_SNIPPET_MAX_CHARS < content.length ? '…' : '';
  return `…${window}${suffix}`;
};

/**
 * Lexical top-k over both memory tiers (fixed entries + dream cards).
 * Deterministic: coverage desc, then token overlap desc, then tier/order.
 */
export const searchAssistantMemory = ({
  dynamicMemory,
  fixedMemory,
  limit = 5,
  query,
}: {
  dynamicMemory?: string | null;
  fixedMemory?: string | null;
  limit?: number;
  query: string;
}): MemorySearchHit[] => {
  const queryTokens = tokenizeMemoryText(query);
  if (queryTokens.size === 0) return [];

  const cap = Math.min(Math.max(Math.floor(limit) || 5, 1), 10);
  const cards: Array<{ content: string; index: number; order: number; source: 'dynamic' | 'fixed' }> = [
    ...parseFixedMemoryEntries(fixedMemory).map((entry, order) => ({
      content: entry.content,
      index: entry.index,
      order,
      source: 'fixed' as const,
    })),
    ...parseDreamMemoryEntries(dynamicMemory).map((entry, order) => ({
      content: entry.body,
      index: entry.index,
      order,
      source: 'dynamic' as const,
    })),
  ];

  return cards
    .map((card) => {
      const cardTokens = tokenizeMemoryText(card.content);
      let overlap = 0;
      for (const token of queryTokens) if (cardTokens.has(token)) overlap += 1;
      return { ...card, overlap, score: overlap / queryTokens.size };
    })
    .filter((card) => card.overlap > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.overlap - a.overlap ||
        (a.source === b.source ? a.order - b.order : a.source === 'fixed' ? -1 : 1),
    )
    .slice(0, cap)
    .map(({ content, index, score, source }) => ({
      content: buildSearchSnippet(content, query),
      index,
      score: Math.round(score * 1000) / 1000,
      source,
    }));
};

/** Full memory text for the `readMemory` recall API (both tiers, as injected). */
export const readAssistantMemory = ({
  dynamicMemory,
  fixedMemory,
}: {
  dynamicMemory?: string | null;
  fixedMemory?: string | null;
}): { dynamic: string; fixed: string; totalChars: number } => {
  const fixed = (fixedMemory ?? '').trim();
  const dynamic = (dynamicMemory ?? '').trim();
  return { dynamic, fixed, totalChars: fixed.length + dynamic.length };
};

/** Upper bound for one entry-scoped read, so the result stays within the tool-result cap. */
export const MEMORY_ENTRY_READ_MAX_CHARS = 7000;

export type MemoryEntryReadResult =
  | {
      content: string;
      index: number;
      source: 'dynamic' | 'fixed';
      truncated: boolean;
    }
  | { availableIndexes: number[]; error: 'not_found'; source: 'dynamic' | 'fixed' };

/**
 * Entry-scoped `readMemory`: return the complete text of one entry addressed
 * by a `searchMemory` hit (`source` + `index`). This is the recall path for
 * entries omitted by the injection budget — a whole-document read is capped by
 * the request pipeline and cannot reach them (F7).
 */
export const readAssistantMemoryEntry = ({
  dynamicMemory,
  fixedMemory,
  index,
  source,
}: {
  dynamicMemory?: string | null;
  fixedMemory?: string | null;
  index: number;
  source: 'dynamic' | 'fixed';
}): MemoryEntryReadResult => {
  if (source === 'fixed') {
    const entries = parseFixedMemoryEntries(fixedMemory);
    const entry = entries.find((item) => item.index === index);
    if (!entry) {
      return { availableIndexes: entries.map((item) => item.index), error: 'not_found', source };
    }
    const truncated = entry.content.length > MEMORY_ENTRY_READ_MAX_CHARS;
    return {
      content: truncated ? entry.content.slice(0, MEMORY_ENTRY_READ_MAX_CHARS) : entry.content,
      index: entry.index,
      source,
      truncated,
    };
  }

  const cards = parseDreamMemoryEntries(normalizeDreamMemoryDocument(dynamicMemory));
  const card = cards.find((item) => item.index === index);
  if (!card) {
    return { availableIndexes: cards.map((item) => item.index), error: 'not_found', source };
  }
  // Raw body, matching what search indexes and the injection renders.
  const truncated = card.body.length > MEMORY_ENTRY_READ_MAX_CHARS;
  return {
    content: truncated ? card.body.slice(0, MEMORY_ENTRY_READ_MAX_CHARS) : card.body,
    index: card.index,
    source,
    truncated,
  };
};

// --- Memory provenance (M2) ---

/** Origin map key for one entry: content hash of the fixed-entry text / dream-card body. */
export const memoryEntryOriginKey = (content: string): string => hashText(content.trim());

/** Recorded origin for one entry; undefined = predates provenance (trusted). */
export const memoryEntryOrigin = (
  entryOrigins: Record<string, MemoryEntryOrigin> | null | undefined,
  content: string,
): MemoryEntryOrigin | undefined => entryOrigins?.[memoryEntryOriginKey(content)];

/** Web browsing tool output is external content for provenance taint. */
const WEB_BROWSING_IDENTIFIER = 'lobe-web-browsing';

/** How many messages before the memory write are scanned for external tool output. */
export const MEMORY_TAINT_WINDOW = 10;

/**
 * Taint rule (M2): a memory write is downgraded to `untrusted` when the
 * writing turn's recent history contains external tool output — MCP/custom
 * plugins or web browsing. The memory tool's own results never taint.
 */
export const isMemoryWriteTainted = (
  recentMessages: Array<{ plugin?: { identifier?: string | null } | null; role?: string | null }>,
  isBuiltinIdentifier: (identifier: string) => boolean,
): boolean =>
  recentMessages.some((message) => {
    if (message.role !== 'tool') return false;
    const identifier = message.plugin?.identifier;
    if (!identifier || identifier === MEMORY_TOOL_IDENTIFIER) return false;
    return identifier === WEB_BROWSING_IDENTIFIER || !isBuiltinIdentifier(identifier);
  });

export interface PartitionedMemoryByTrust {
  dynamicMemory?: string;
  fixedMemory?: string;
  /** Untrusted entries/cards serialized for a separate, clearly marked section. */
  untrustedMemory?: string;
}

/**
 * Split both memory tiers into trusted content (rendered as today) and
 * `untrusted` entries (rendered in a separate "treat as data" section).
 * Byte-stable fast path: with no untrusted entries the input docs pass through
 * unchanged, so prompt-cache prefixes are unaffected for existing agents.
 */
export const partitionMemoryByTrust = ({
  dynamicMemory,
  entryOrigins,
  fixedMemory,
}: {
  dynamicMemory?: string | null;
  entryOrigins?: Record<string, MemoryEntryOrigin> | null;
  fixedMemory?: string | null;
} = {}): PartitionedMemoryByTrust => {
  const fixed = (fixedMemory ?? '').trim() || undefined;
  const dynamic = (dynamicMemory ?? '').trim() || undefined;
  if (!entryOrigins || Object.keys(entryOrigins).length === 0) {
    return { dynamicMemory: dynamic, fixedMemory: fixed };
  }

  const isUntrusted = (content: string) =>
    entryOrigins[memoryEntryOriginKey(content)] === 'untrusted';

  // Fixed tier: pull untrusted entry lines out; keep all other lines in place.
  // Continuation lines inherit the preceding entry's trust (F3): entries are
  // single-line by contract, but a legacy/pre-fix multiline entry must not
  // leak its tail into the trusted block. Free-form lines before the first
  // entry (owner preamble) stay trusted.
  const trustedFixedLines: string[] = [];
  const untrustedFixed: string[] = [];
  let currentEntryUntrusted = false;
  for (const line of (fixed ?? '').split('\n')) {
    const match = FIXED_MEMORY_ENTRY_LINE.exec(line);
    if (match) {
      currentEntryUntrusted = isUntrusted(match[2].trim());
      if (currentEntryUntrusted) untrustedFixed.push(`#${match[1]}: ${match[2].trim()}`);
      else trustedFixedLines.push(line);
    } else if (currentEntryUntrusted) {
      untrustedFixed.push(line);
    } else {
      trustedFixedLines.push(line);
    }
  }

  // Dynamic tier: split dream cards (normalize first so a legacy preamble is kept as a card).
  const trustedCards: DreamMemoryEntry[] = [];
  const untrustedCards: DreamMemoryEntry[] = [];
  for (const entry of parseDreamMemoryEntries(normalizeDreamMemoryDocument(dynamic))) {
    (isUntrusted(entry.body) ? untrustedCards : trustedCards).push(entry);
  }

  if (untrustedFixed.length === 0 && untrustedCards.length === 0) {
    return { dynamicMemory: dynamic, fixedMemory: fixed };
  }

  const untrusted = [
    ...untrustedFixed,
    ...untrustedCards.map((entry) => serializeDreamMemoryEntries([entry])),
  ].join('\n');

  return {
    dynamicMemory: serializeDreamMemoryEntries(trustedCards) || undefined,
    fixedMemory: trustedFixedLines.join('\n').trim() || undefined,
    untrustedMemory: untrusted || undefined,
  };
};

/**
 * Tag entries that appear in `nextDoc` but not in `previousDoc` (and have no
 * recorded origin) with `origin`:
 * - `owner` for user edits in assistant settings;
 * - `agent` / `untrusted` for memory-tool writes (taint-dependent).
 * Entries whose content already existed keep their recorded origin — a user
 * re-saving the doc does not launder an `untrusted` entry into `owner`.
 */
export const mergeNewEntryOrigins = (
  previousDoc: string | null | undefined,
  nextDoc: string | null | undefined,
  entryOrigins: Record<string, MemoryEntryOrigin> | null | undefined,
  origin: MemoryEntryOrigin,
): Record<string, MemoryEntryOrigin> | undefined => {
  const previousContents = new Set(
    parseFixedMemoryEntries(previousDoc).map((entry) => memoryEntryOriginKey(entry.content)),
  );
  let next: Record<string, MemoryEntryOrigin> | undefined;
  for (const entry of parseFixedMemoryEntries(nextDoc)) {
    const key = memoryEntryOriginKey(entry.content);
    if (previousContents.has(key) || entryOrigins?.[key]) continue;
    next = { ...next, [key]: origin };
  }
  return next;
};

/**
 * Dream-path provenance sync (M2): prune origins whose content no longer
 * exists in either tier, then tag dream cards with no recorded origin as
 * `dream` (the dynamic tier is only ever written by the dream job). Existing
 * origins (`owner` / `agent` / `untrusted`) are preserved.
 */
export const syncDreamEntryOrigins = (
  dynamicMemory: string | null | undefined,
  {
    entryOrigins,
    fixedMemory,
  }: {
    entryOrigins?: Record<string, MemoryEntryOrigin> | null;
    fixedMemory?: string | null;
  },
): Record<string, MemoryEntryOrigin> | undefined => {
  const liveKeys = new Set<string>();
  for (const entry of parseFixedMemoryEntries(fixedMemory)) {
    liveKeys.add(memoryEntryOriginKey(entry.content));
  }
  const cards = parseDreamMemoryEntries(normalizeDreamMemoryDocument(dynamicMemory));
  for (const card of cards) liveKeys.add(memoryEntryOriginKey(card.body));

  let next: Record<string, MemoryEntryOrigin> | undefined;
  for (const [key, origin] of Object.entries(entryOrigins ?? {})) {
    if (liveKeys.has(key)) next = { ...next, [key]: origin };
  }
  for (const card of cards) {
    const key = memoryEntryOriginKey(card.body);
    if (!next?.[key]) next = { ...next, [key]: 'dream' };
  }
  return next;
};

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

export type DreamMemoryMutationError = 'mismatch' | 'not_found';

const DREAM_MERGED_TAG = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/;
export const isDreamMergedTag = (tag: string) => DREAM_MERGED_TAG.test(tag);

/** Leading magic line for canonical overflow. Not part of any day's body. */
export const DREAM_OVERFLOW_SENTINEL = '[overflow:v1]';
/** Interim opaque envelope from `fedec80487`/`5a28abacf9`. Never framing; treat as payload. */
export const DREAM_OVERFLOW_OPAQUE_V1_SENTINEL = '[overflow:opaque-v1]';
/** Interim bare opaque envelope from `fda686b6a7`. Never framing; treat as payload. */
export const DREAM_OVERFLOW_OPAQUE_V2_SENTINEL = '[overflow:opaque-v2]';
/** Validated opaque envelope prefix. Framing only when `n` and `crc` match the payload. */
export const DREAM_OVERFLOW_OPAQUE_V3_PREFIX = '[overflow:opaque-v3 n=';
const CANONICAL_PART_MARKER = /^\[date:(\d{4}-\d{2}-\d{2})]$/;
const OPAQUE_V3_HEADER = /^\[overflow:opaque-v3 n=(\d+) crc=([\da-f]{8})]$/;
/** Worst-case header plus newline for a 6400-character payload. */
const OPAQUE_V3_MAX_OVERHEAD = `[overflow:opaque-v3 n=${ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS} crc=ffffffff]\n`
  .length;

const splitMergedBodyLines = (text: string): string[] =>
  text.split('\n').map((line) => line.replace(/\r$/, ''));

const stripLeadingMagicLine = (body: string, sentinel: string): string => {
  const lines = splitMergedBodyLines(body);
  const first = lines.findIndex((line) => line.length > 0);
  if (first === -1 || lines[first] !== sentinel) return body;
  return lines.slice(first + 1).join('\n').replace(/^\n+/, '');
};

const stripLeadingOverflowSentinelLine = (text: string): string =>
  stripLeadingMagicLine(text, DREAM_OVERFLOW_SENTINEL);

/**
 * FNV-1a 32-bit over UTF-8 bytes (IETF/FNV offset 0x811c9dc5, prime 0x01000193).
 * Checksum only — not cryptographic. Combined with an exact length prefix so a
 * user-typed header cannot match unless the rest of the body is that payload.
 */
const fnv1a32Hex = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x81_1C_9D_C5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeOpaquePayload = (text: string): string => splitMergedBodyLines(text).join('\n');

const decodeOpaqueOverflowPayload = (body: string): string | undefined => {
  const lines = splitMergedBodyLines(body);
  const first = lines.findIndex((line) => line.length > 0);
  if (first < 0) return undefined;
  const match = OPAQUE_V3_HEADER.exec(lines[first]!);
  if (!match) return undefined;
  const payload = lines.slice(first + 1).join('\n');
  if (payload.length !== Number(match[1])) return undefined;
  if (fnv1a32Hex(payload) !== match[2]) return undefined;
  return payload;
};

const wrapOpaqueOverflowBody = (inner: string): string => {
  const payload = normalizeOpaquePayload(inner);
  const header = `[overflow:opaque-v3 n=${payload.length} crc=${fnv1a32Hex(payload)}]`;
  return payload ? `${header}\n${payload}` : header;
};

export const hasOpaqueOverflowEnvelope = (body: string, dateTag?: string): boolean => {
  if (dateTag !== undefined && !isDreamMergedTag(dateTag)) return false;
  return decodeOpaqueOverflowPayload(body) !== undefined;
};

const opaquePayloadBody = (entry: Pick<DreamMemoryEntry, 'body' | 'dateTag'>): string => {
  if (!hasOpaqueOverflowEnvelope(entry.body, entry.dateTag)) return entry.body;
  return decodeOpaqueOverflowPayload(entry.body) ?? entry.body;
};

/** Non-scheduled tags such as `[legacy]` or pre-feature custom labels. */
export const isDreamCustomTag = (tag: string) =>
  tag !== 'legacy' && !isDreamMergedTag(tag) && !isDreamSingleDayTag(tag);

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
const LEGACY_PART_MARKER = /^\[(\d{4}-\d{2}-\d{2})]$/;
/** Marker-shaped line, optionally already backslash-stuffed. */
const MARKER_SHAPED_LINE =
  /^(\\*)(\[(?:date:)?\d{4}-\d{2}-\d{2}]|\[overflow:v1]|\[overflow:opaque-v\d+])$/;

/** Logical n slashes ↔ stored n+1. Adds one slash to every marker-shaped line. */
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

/** Keep stuffed `[date:]` content escaped in the editor so it is not reparsed as a heading. */
const unescapeVisibleOverflowBody = (body: string): string =>
  splitMergedBodyLines(body)
    .map((line) => {
      const match = MARKER_SHAPED_LINE.exec(line);
      if (!match || match[1]!.length === 0) return line;
      if (match[2]!.startsWith('[date:')) return line;
      return line.slice(1);
    })
    .join('\n');

/** Inverse of unescapeVisibleOverflowBody for card save. */
const restuffVisibleOverflowBody = (body: string): string =>
  splitMergedBodyLines(body)
    .map((line) => {
      const match = MARKER_SHAPED_LINE.exec(line);
      if (!match) return line;
      if (match[2]!.startsWith('[date:')) return line;
      return `\\${line}`;
    })
    .join('\n');

const formatMergedDreamBody = (parts: MergedDreamPart[]): string => {
  const inner = parts
    .map(({ body, date }) => {
      const header = mergedPartHeaderLine(date);
      const escaped = escapeMergedPartBody(body);
      return escaped ? `${header}\n${escaped}` : header;
    })
    .join('\n\n')
    .trim();
  return inner ? `${DREAM_OVERFLOW_SENTINEL}\n${inner}` : DREAM_OVERFLOW_SENTINEL;
};

const parseMergedRangeBounds = (tag: string): { end: string; start: string } => {
  const [start, end] = tag.split('..');
  return { end: end ?? start ?? tag, start: start ?? tag };
};

const consumeMergedPartLines = (
  lines: string[],
  marker: RegExp,
  acceptDate: (date: string) => boolean,
  startDate: string,
): { parts: MergedDreamPart[]; usedHeading: boolean } => {
  const parts: MergedDreamPart[] = [];
  let current: MergedDreamPart | null = null;
  const preamble: string[] = [];
  let usedHeading = false;

  const flushPreamble = () => {
    const text = preamble.join('\n').trim();
    preamble.length = 0;
    return text;
  };

  for (const line of lines) {
    const match = marker.exec(line);
    if (match && acceptDate(match[1]!)) {
      usedHeading = true;
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
  return { parts, usedHeading };
};

const rangeTagOfParts = (parts: MergedDreamPart[]): string =>
  parts.length === 0 ? '' : `${parts[0]!.date}..${parts.at(-1)!.date}`;

const uniqueCanonicalOverflowControl = (restLines: string[], dateTag: string): boolean => {
  if (!isDreamMergedTag(dateTag)) return false;
  const { start, end } = parseMergedRangeBounds(dateTag);
  const inRange = (date: string) => date >= start && date <= end;
  const outer = `${start}..${end}`;
  const matchesOuter = (result: { parts: MergedDreamPart[]; usedHeading: boolean }) =>
    result.usedHeading && result.parts.length > 0 && rangeTagOfParts(result.parts) === outer;
  const canonical = consumeMergedPartLines(restLines, CANONICAL_PART_MARKER, inRange, start);
  const legacy = consumeMergedPartLines(restLines, LEGACY_PART_MARKER, inRange, start);
  return matchesOuter(canonical) && !matchesOuter(legacy);
};

/** True only when a leading sentinel uniquely reconstructs the outer range as canonical overflow. */
export const hasDreamOverflowControlMarker = (body: string, dateTag?: string): boolean => {
  const lines = splitMergedBodyLines(body);
  const first = lines.findIndex((line) => line.length > 0);
  if (first === -1 || lines[first] !== DREAM_OVERFLOW_SENTINEL) return false;
  if (!dateTag) return false;
  return uniqueCanonicalOverflowControl(lines.slice(first + 1), dateTag);
};

/** PII-safe overflow framing kind for compaction-debug. Never returns marker text. */
export type DreamOverflowEnvelopeKind = 'none' | 'opaque_payload' | 'opaque_v3' | 'overflow_v1';

export const classifyDreamOverflowEnvelope = (
  body: string,
  dateTag?: string,
): DreamOverflowEnvelopeKind => {
  if (!dateTag || !isDreamMergedTag(dateTag)) return 'none';
  if (hasOpaqueOverflowEnvelope(body, dateTag)) return 'opaque_v3';
  if (hasDreamOverflowControlMarker(body, dateTag)) return 'overflow_v1';
  return 'opaque_payload';
};

/** Re-attach the stored control marker so a user-typed leading sentinel stays content. */
const restoreOverflowControlMarker = (previous: string, visible: string, dateTag: string): string => {
  if (hasOpaqueOverflowEnvelope(previous, dateTag)) {
    return wrapOpaqueOverflowBody(visible);
  }
  return hasDreamOverflowControlMarker(previous, dateTag)
    ? `${DREAM_OVERFLOW_SENTINEL}\n${restuffVisibleOverflowBody(visible)}`
    : visible;
};

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

  const nextBody = isDreamMergedTag(target.dateTag)
    ? restoreOverflowControlMarker(target.body, body.trim(), target.dateTag)
    : body.trim();
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

export const stripDreamOverflowSentinel = (body: string, dateTag?: string): string => {
  if (!hasDreamOverflowControlMarker(body, dateTag)) return body;
  return stripLeadingOverflowSentinelLine(body);
};

export const visibleDreamMemoryBody = (
  entry: Pick<DreamMemoryEntry, 'body' | 'dateTag'>,
): string => {
  if (hasOpaqueOverflowEnvelope(entry.body, entry.dateTag)) {
    return decodeOpaqueOverflowPayload(entry.body) ?? entry.body;
  }
  return isDreamMergedTag(entry.dateTag)
    ? unescapeVisibleOverflowBody(stripDreamOverflowSentinel(entry.body, entry.dateTag))
    : entry.body;
};

export const serializeVisibleDreamMemoryDocument = (doc: string | null | undefined): string =>
  serializeDreamMemoryEntries(
    parseDreamMemoryEntries(doc).map((entry) => ({
      ...entry,
      body: visibleDreamMemoryBody(entry),
    })),
  );

const splitOverflowBodyLines = (
  body: string,
  dateTag: string,
): { forceCanonical: boolean; lines: string[] } => {
  const lines = splitMergedBodyLines(body);
  const first = lines.findIndex((line) => line.length > 0);
  if (first >= 0 && hasDreamOverflowControlMarker(body, dateTag)) {
    return { forceCanonical: true, lines: lines.slice(first + 1) };
  }
  return { forceCanonical: false, lines };
};

const unescapeOverflowParts = (parts: MergedDreamPart[]): MergedDreamPart[] =>
  parts.map((part) => ({ ...part, body: unescapeMergedPartBody(part.body) }));

type OverflowExpansion =
  | { kind: 'opaque' }
  | { kind: 'parts'; parts: MergedDreamPart[] };

const resolveOverflowExpansion = (entry: DreamMemoryEntry): OverflowExpansion => {
  if (!isDreamMergedTag(entry.dateTag)) {
    return { kind: 'parts', parts: [{ body: entry.body, date: entry.dateTag }] };
  }
  if (hasOpaqueOverflowEnvelope(entry.body, entry.dateTag)) return { kind: 'opaque' };

  const { start, end } = parseMergedRangeBounds(entry.dateTag);
  const inRange = (date: string) => date >= start && date <= end;
  const outer = `${start}..${end}`;
  const { forceCanonical, lines } = splitOverflowBodyLines(entry.body, entry.dateTag);
  if (forceCanonical) {
    const { parts, usedHeading } = consumeMergedPartLines(
      lines,
      CANONICAL_PART_MARKER,
      inRange,
      start,
    );
    if (usedHeading && parts.length > 0 && rangeTagOfParts(parts) === outer) {
      return { kind: 'parts', parts: unescapeOverflowParts(parts) };
    }
    return { kind: 'opaque' };
  }

  const canonical = consumeMergedPartLines(lines, CANONICAL_PART_MARKER, inRange, start);
  const legacy = consumeMergedPartLines(lines, LEGACY_PART_MARKER, inRange, start);
  const matchesOuter = (result: { parts: MergedDreamPart[]; usedHeading: boolean }) =>
    result.usedHeading && result.parts.length > 0 && rangeTagOfParts(result.parts) === outer;
  const canonicalOk = matchesOuter(canonical);
  const legacyOk = matchesOuter(legacy);
  if (canonicalOk === legacyOk) return { kind: 'opaque' };
  return {
    kind: 'parts',
    parts: unescapeOverflowParts(canonicalOk ? canonical.parts : legacy.parts),
  };
};

/** Total serialized dynamic-memory char budget: N single-day cards + one 6400 overflow slot. */
export const dreamMemoryTotalCharBudget = (maxEntries: number) =>
  maxEntries * ASSISTANT_MEMORY_MAX_CHARS + ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS;

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
  if (body.length > ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS) {
    next = trimMergedPartsToBudget(next, ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
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

const buildOverflowCard = (parts: MergedDreamPart[]): DreamMemoryEntry[] => {
  const rebuilt = rebuildMergedEntry(
    { body: '', dateTag: '1970-01-01..1970-01-01', index: 1, regenerable: false },
    parts,
  );
  return rebuilt ? [rebuilt] : [];
};

const keepOverflowTail = (body: string, maxChars: number): string => {
  if (body.length <= maxChars) return body;
  const tail = body.slice(body.length - maxChars);
  const newline = tail.indexOf('\n');
  if (newline >= 0 && newline < Math.floor(maxChars * 0.35)) {
    const snapped = tail.slice(newline + 1);
    if (snapped.length > 0) return snapped;
  }
  return tail;
};

const capOpaqueMergedEntries = (
  entries: DreamMemoryEntry[],
  budget: number,
): DreamMemoryEntry[] => {
  if (entries.length === 0) return [];
  const maxBody = Math.max(0, Math.min(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS, budget));
  const starts = entries.map((entry) => parseMergedRangeBounds(entry.dateTag).start);
  const ends = entries.map((entry) => parseMergedRangeBounds(entry.dateTag).end);
  const dateTag =
    entries.length === 1
      ? entries[0]!.dateTag
      : `${starts.reduce((min, date) => (date < min ? date : min))}..${ends.reduce(
          (max, date) => (date > max ? date : max),
        )}`;
  const joined = entries.map((entry) => opaquePayloadBody(entry)).join('\n\n');
  const innerBudget = Math.max(0, maxBody - OPAQUE_V3_MAX_OVERHEAD);
  const inner = keepOverflowTail(joined, innerBudget);
  return [
    {
      body: wrapOpaqueOverflowBody(inner),
      dateTag,
      index: 1,
      regenerable: false,
    },
  ];
};

const rebuildOverflowFromEntries = (
  entries: DreamMemoryEntry[],
  budget: number,
): DreamMemoryEntry[] => {
  if (entries.length === 0) return [];
  const resolved = entries.map((entry) => ({
    entry,
    expansion: resolveOverflowExpansion(entry),
  }));
  if (resolved.every((item) => item.expansion.kind === 'parts')) {
    const parts = resolved.flatMap((item) =>
      item.expansion.kind === 'parts' ? item.expansion.parts : [],
    );
    parts.sort((a, b) => a.date.localeCompare(b.date));
    return buildOverflowCard(trimMergedPartsToBudget(parts, budget));
  }
  return capOpaqueMergedEntries(
    resolved.map((item) => item.entry),
    budget,
  );
};

const overflowBodyBudget = (othersLength: number, budget: number) =>
  Math.max(0, Math.min(ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS, budget - othersLength - 40));

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
  let merged = rebuildOverflowFromEntries(
    parsed.filter((entry) => isDreamMergedTag(entry.dateTag)),
    overflowBodyBudget(dreamDocumentLength([...legacy, ...custom, ...singleDay]), budget),
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
      const next = rebuildOverflowFromEntries(
        merged,
        overflowBodyBudget(dreamDocumentLength([...legacy, ...custom, ...singleDay]), budget),
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
  return capAtReadableBoundary(serialized, ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
};

export interface DreamMemoryRetentionPlan {
  custom: DreamMemoryEntry[];
  fold: DreamMemoryEntry[];
  keep: DreamMemoryEntry[];
  legacy: DreamMemoryEntry[];
  overflow: DreamMemoryEntry[];
}

export const planDreamMemoryRetention = (
  doc: string | null | undefined,
  maxEntries: number,
): DreamMemoryRetentionPlan => {
  const entries = parseDreamMemoryEntries(normalizeDreamMemoryDocument(doc));
  const legacy = entries.filter((entry) => entry.dateTag === 'legacy');
  const custom = entries.filter((entry) => isDreamCustomTag(entry.dateTag));
  const overflow = entries.filter((entry) => isDreamMergedTag(entry.dateTag));
  const singleDay = entries
    .filter((entry) => entry.regenerable)
    .sort((a, b) => a.dateTag.localeCompare(b.dateTag));

  if (singleDay.length <= maxEntries) {
    return { custom, fold: [], keep: singleDay, legacy, overflow };
  }

  return {
    custom,
    fold: singleDay.slice(0, singleDay.length - maxEntries),
    keep: singleDay.slice(-maxEntries),
    legacy,
    overflow,
  };
};

export interface DreamMemoryDebugSnapshot {
  customCount: number;
  foldCount: number;
  keepCount: number;
  legacyCount: number;
  overflowChars?: number;
  overflowCount: number;
  overflowEnvelope: DreamOverflowEnvelopeKind;
  overflowRangeEnd?: string;
  overflowRangeStart?: string;
  singleDayCount: number;
}

export const dreamMemoryDebugSnapshot = (
  doc: string | null | undefined,
  maxEntries: number,
): DreamMemoryDebugSnapshot => {
  const plan = planDreamMemoryRetention(doc, maxEntries);
  const overflow = plan.overflow[0];
  const overflowEnvelope = overflow
    ? classifyDreamOverflowEnvelope(overflow.body, overflow.dateTag)
    : 'none';
  const bounds = overflow ? parseMergedRangeBounds(overflow.dateTag) : undefined;
  return {
    customCount: plan.custom.length,
    foldCount: plan.fold.length,
    keepCount: plan.keep.length,
    legacyCount: plan.legacy.length,
    overflowChars: overflow?.body.length,
    overflowCount: plan.overflow.length,
    overflowEnvelope,
    overflowRangeEnd: bounds?.end,
    overflowRangeStart: bounds?.start,
    singleDayCount: plan.keep.length + plan.fold.length,
  };
};

export const overflowRangeForFold = (
  plan: DreamMemoryRetentionPlan,
): { end: string; start: string } | undefined => {
  const dates: string[] = [];
  for (const entry of plan.overflow) {
    const bounds = parseMergedRangeBounds(entry.dateTag);
    dates.push(bounds.start, bounds.end);
  }
  for (const entry of plan.fold) dates.push(entry.dateTag);
  if (dates.length === 0) return undefined;
  dates.sort((left, right) => left.localeCompare(right));
  return { end: dates.at(-1)!, start: dates[0]! };
};

const concatOverflowEntry = (
  overflow: DreamMemoryEntry[],
  fold: DreamMemoryEntry[],
): DreamMemoryEntry | undefined => {
  if (overflow.length === 0 && fold.length === 0) return undefined;

  const overflowSorted = [...overflow].sort((left, right) =>
    parseMergedRangeBounds(left.dateTag).start.localeCompare(
      parseMergedRangeBounds(right.dateTag).start,
    ),
  );
  const foldSorted = [...fold].sort((left, right) => left.dateTag.localeCompare(right.dateTag));
  const expansions = overflowSorted.map((entry) => resolveOverflowExpansion(entry));
  const hasOpaque = expansions.some((expansion) => expansion.kind === 'opaque');

  if (!hasOpaque) {
    const foldedParts: MergedDreamPart[] = [];
    for (const expansion of expansions) {
      if (expansion.kind === 'parts') foldedParts.push(...expansion.parts);
    }
    for (const entry of foldSorted) foldedParts.push({ body: entry.body, date: entry.dateTag });
    if (foldedParts.length === 0) return undefined;
    foldedParts.sort((a, b) => a.date.localeCompare(b.date));
    return {
      body: formatMergedDreamBody(foldedParts),
      dateTag: `${foldedParts[0]!.date}..${foldedParts.at(-1)!.date}`,
      index: 1,
      regenerable: false,
    };
  }

  const combined = [
    ...overflowSorted,
    ...foldSorted.map((entry) => ({ ...entry, regenerable: false })),
  ];
  const [rebuilt] = capOpaqueMergedEntries(combined, ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS);
  return rebuilt;
};

/** Wrap an LLM overflow summary as a sentinel-bearing range card body. Does not trim. */
export const wrapOverflowSummaryBody = (summary: string, start: string, end: string): string => {
  let text = summary.trim().replace(/^#\d+\s+\[[^\n\]]+]:\s*/, '');
  text = stripLeadingOverflowSentinelLine(text).trim();
  text = (decodeOpaqueOverflowPayload(text) ?? text).trim();
  const parts: MergedDreamPart[] = [{ body: text, date: start }];
  if (end !== start) parts.push({ body: '', date: end });
  return formatMergedDreamBody(parts);
};

/** Max summary text so wrapOverflowSummaryBody stays within the 6400-character card cap. */
export const overflowSummaryTextBudget = (start: string, end: string): number => {
  const overhead = wrapOverflowSummaryBody('x', start, end).length - 1;
  return Math.max(0, ASSISTANT_MEMORY_OVERFLOW_MAX_CHARS - overhead);
};

export const assembleDreamMemoryAfterFold = (
  plan: DreamMemoryRetentionPlan,
  overflowEntry: DreamMemoryEntry,
  maxEntries: number,
): string => {
  const next = [...plan.legacy, ...plan.custom, overflowEntry, ...plan.keep];
  return capDreamMemoryDocument(
    serializeDreamMemoryEntries(renumberDreamMemoryEntries(next)),
    maxEntries,
  );
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

  const plan = planDreamMemoryRetention(normalized, maxEntries);
  if (plan.fold.length === 0) {
    return capDreamMemoryDocument(
      serializeDreamMemoryEntries(renumberDreamMemoryEntries(entries)),
      maxEntries,
    );
  }

  const overflowEntry = concatOverflowEntry(plan.overflow, plan.fold);
  if (!overflowEntry) {
    return capDreamMemoryDocument(
      serializeDreamMemoryEntries(renumberDreamMemoryEntries([...plan.legacy, ...plan.custom, ...plan.keep])),
      maxEntries,
    );
  }

  return assembleDreamMemoryAfterFold(plan, overflowEntry, maxEntries);
};
