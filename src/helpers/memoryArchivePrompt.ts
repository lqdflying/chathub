import type { TopicMemoryArchiveEntry } from '@lobechat/types';

import { normalizeAssistantMemoryText } from './assistantMemory';

interface BuildHistorySummaryForRequestParams {
  archives?: TopicMemoryArchiveEntry[];
  assistantMemory?: string;
  enableCompressHistory?: boolean;
  enableUserMemoryArchive?: boolean;
  topicSummary?: string;
}

/**
 * Merge assistant-wide notes with the active topic’s compaction summary for a single
 * `historySummary` payload (wrapped once by the context engine).
 */
export const combineAssistantMemoryWithTopicSummary = (
  assistantMemory: string | undefined,
  topicSummaryWithArchives: string | undefined,
): string | undefined => {
  const am = normalizeAssistantMemoryText(assistantMemory);
  const ts = (topicSummaryWithArchives ?? '').trim();
  if (!am && !ts) return undefined;
  if (!am) return ts;
  if (!ts) return am;
  return `## Assistant memory\n\n${am}\n\n---\n\n## Current topic summary\n\n${ts}`;
};

const formatArchiveTime = (at: number): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString();
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
    .map((a) => `[${formatArchiveTime(a.at)}] ${a.summaryExcerpt}`)
    .join('\n');

  if (!block) return summaryContent;

  const base = (summaryContent ?? '').trim();
  const header = '### Memory archive (recent snapshots)';
  if (!base) return `${header}\n${block}`;

  return `${base}\n\n${header}\n${block}`;
};

export const buildHistorySummaryForRequest = ({
  archives,
  assistantMemory,
  enableCompressHistory,
  enableUserMemoryArchive,
  topicSummary,
}: BuildHistorySummaryForRequestParams): string | undefined => {
  const topicSummaryBlock = enableCompressHistory
    ? appendMemoryArchivesToHistorySummary(topicSummary, archives, !!enableUserMemoryArchive)
    : undefined;

  return combineAssistantMemoryWithTopicSummary(assistantMemory, topicSummaryBlock);
};
