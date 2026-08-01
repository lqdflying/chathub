import type { TopicMemoryArchiveEntry } from '@lobechat/types';

interface BuildHistorySummaryForRequestParams {
  archives?: TopicMemoryArchiveEntry[];
  enableCompressHistory?: boolean;
  enableUserMemoryArchive?: boolean;
  topicSummary?: string;
}

const formatArchiveTime = (at: number): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString();
};

const MAX_INJECTED_ARCHIVES = 8;

/**
 * Append recent topic memory archive excerpts after the rolling history summary text.
 *
 * Archive excerpts are prefixes of successive versions of the same cumulative
 * summary, so entries contained in the current summary (or in a newer kept
 * excerpt) are dropped instead of injected as near-duplicates.
 */
export const appendMemoryArchivesToHistorySummary = (
  summaryContent: string | undefined,
  archives: TopicMemoryArchiveEntry[] | undefined,
  enabled: boolean,
): string | undefined => {
  if (!enabled || !archives?.length) return summaryContent;

  const base = (summaryContent ?? '').trim();

  const keptExcerpts: string[] = [];
  const keptNewestFirst = [...archives].reverse().filter((entry) => {
    const excerpt = (entry.summaryExcerpt ?? '').trim();
    if (!excerpt) return false;
    if (base.includes(excerpt)) return false;
    if (keptExcerpts.some((seen) => seen.includes(excerpt))) return false;
    keptExcerpts.push(excerpt);
    return true;
  });

  const block = keptNewestFirst
    .slice(0, MAX_INJECTED_ARCHIVES)
    .reverse()
    .map((a) => `[${formatArchiveTime(a.at)}] ${a.summaryExcerpt.trim()}`)
    .join('\n');

  if (!block) return summaryContent;

  const header = '### Memory archive (recent snapshots)';
  if (!base) return `${header}\n${block}`;

  return `${base}\n\n${header}\n${block}`;
};

/**
 * Build the topic-scoped history summary payload (wrapped once by the context
 * engine). Assistant memory is no longer merged here — it is injected
 * separately via the `AgentMemoryProvider`.
 */
export const buildHistorySummaryForRequest = ({
  archives,
  enableCompressHistory,
  enableUserMemoryArchive,
  topicSummary,
}: BuildHistorySummaryForRequestParams): string | undefined => {
  if (!enableCompressHistory) return undefined;

  const summary = appendMemoryArchivesToHistorySummary(
    topicSummary,
    archives,
    !!enableUserMemoryArchive,
  );

  const trimmed = (summary ?? '').trim();
  return trimmed || undefined;
};
