import type { MessageMetadata } from '@lobechat/types';

const isFiniteMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const resolveFooterTotalTimeMs = (
  metadata?: Pick<MessageMetadata, 'duration' | 'latency'> | null,
): number | undefined => {
  if (isFiniteMs(metadata?.latency)) return metadata.latency;
  if (isFiniteMs(metadata?.duration)) return metadata.duration;
  return undefined;
};

/** Compact chip: `40s`, `1m`, `1m 12s`. */
export const formatGenerationDuration = (ms?: number | null): string | undefined => {
  if (!isFiniteMs(ms)) return undefined;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
};

export const getFooterTimeChipLabel = (
  metadata?: Pick<MessageMetadata, 'duration' | 'latency'> | null,
): string | undefined => formatGenerationDuration(resolveFooterTotalTimeMs(metadata));
