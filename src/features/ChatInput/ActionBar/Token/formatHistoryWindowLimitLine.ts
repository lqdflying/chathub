export type HistoryWindowLimitDisplayInput = {
  configuredHistoryCount: number;
  effectiveHistoryCount: number;
  expanded: boolean;
};

type LimitTranslator = (key: string, options?: { count?: number }) => string;

export const formatHistoryWindowLimitLine = (
  historyWindow: HistoryWindowLimitDisplayInput,
  t: LimitTranslator,
): string => {
  let line = t('tokenDetails.historyWindow.limit', {
    count: historyWindow.configuredHistoryCount,
  });

  if (
    historyWindow.expanded &&
    historyWindow.effectiveHistoryCount > historyWindow.configuredHistoryCount
  ) {
    line += ` · ${t('tokenDetails.historyWindow.expandedLimit', {
      count: historyWindow.effectiveHistoryCount,
    })}`;
  }

  return line;
};
