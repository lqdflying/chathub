import type { TopicMemoryArchiveEntry } from '@lobechat/types';

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
