export const formatCodexPlanLabel = (plan?: string | null) => {
  const trimmed = plan?.trim();
  if (!trimmed) return undefined;

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

export const clampCodexUsagePercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;

  return Math.min(100, Math.max(0, Math.round(value)));
};

export const resolveCodexUsageStroke = (percent: number) => {
  if (percent >= 40) return 'success';
  if (percent >= 15) return 'normal';
  return 'exception';
};
