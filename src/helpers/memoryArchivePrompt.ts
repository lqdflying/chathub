import type { TopicMemoryArchiveEntry } from '@lobechat/types';

/**
 * Merge assistant-wide notes with the active topic’s compaction summary for a single
 * `historySummary` payload (wrapped once by the context engine).
 */
export const combineAssistantMemoryWithTopicSummary = (
  assistantMemory: string | undefined,
  topicSummaryWithArchives: string | undefined,
): string | undefined => {
  const am = (assistantMemory ?? '').trim();
  const ts = (topicSummaryWithArchives ?? '').trim();
  if (!am && !ts) return undefined;
  if (!am) return ts;
  if (!ts) return am;
  return `${am}\n\n---\n\n${ts}`;
};

/** Append recent topic memory archive excerpts after the rolling history summary text. */
export const appendMemoryArchivesToHistorySummary = (
  summaryContent: string | undefined,
  archives: TopicMemoryArchiveEntry[] | undefined,
  enabled: boolean,
): string | undefined => {
  if (!enabled || !archives?.length) return summaryContent;

  const block = archives
    .slice(-8)
    .map((a) => `[${new Date(a.at).toISOString()}] ${a.summaryExcerpt}`)
    .join('\n');

  if (!block) return summaryContent;

  const base = (summaryContent ?? '').trim();
  const header = '### Memory archive (recent snapshots)';
  if (!base) return `${header}\n${block}`;

  return `${base}\n\n${header}\n${block}`;
};
