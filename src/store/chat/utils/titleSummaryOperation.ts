const titleSummaryPersistenceQueues = new Map<string, Promise<void>>();

export const enqueueTitleSummaryPersistence = async (
  operationKey: string,
  persistTitle: () => Promise<void>,
): Promise<void> => {
  const previousPersistence = titleSummaryPersistenceQueues.get(operationKey) ?? Promise.resolve();
  const currentPersistence = previousPersistence.catch(() => undefined).then(persistTitle);

  titleSummaryPersistenceQueues.set(operationKey, currentPersistence);

  try {
    await currentPersistence;
  } finally {
    if (titleSummaryPersistenceQueues.get(operationKey) === currentPersistence) {
      titleSummaryPersistenceQueues.delete(operationKey);
    }
  }
};
