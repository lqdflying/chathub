export const readPlanningPhaseEnteredAtFromConfig = (
  config?: { planningPhaseEnteredAt?: string } | null,
): string | undefined =>
  typeof config?.planningPhaseEnteredAt === 'string' && config.planningPhaseEnteredAt
    ? config.planningPhaseEnteredAt
    : undefined;

export const attachPlanningPhaseEnteredAt = <
  T extends { config?: { planningPhaseEnteredAt?: string }; id: string; phase?: string | null },
>(
  operations: T[],
  eventFallback: Map<string, string> = new Map(),
): Array<T & { phaseEnteredAt?: string }> =>
  operations.map((operation) => {
    if (operation.phase !== 'planning') {
      return { ...operation, phaseEnteredAt: undefined };
    }
    return {
      ...operation,
      phaseEnteredAt:
        readPlanningPhaseEnteredAtFromConfig(operation.config) ?? eventFallback.get(operation.id),
    };
  });

export const resolveSyncedPlanningPhaseEnteredAt = ({
  attached,
  operation,
}: {
  attached?: { operationId: string; phase?: string; phaseEnteredAt?: string };
  operation: { id: string; phase?: string | null; phaseEnteredAt?: string | null };
}): string | undefined => {
  if (operation.phase !== 'planning') return undefined;
  if (typeof operation.phaseEnteredAt === 'string' && operation.phaseEnteredAt) {
    return operation.phaseEnteredAt;
  }
  if (
    attached?.operationId === operation.id &&
    attached.phase === 'planning' &&
    attached.phaseEnteredAt
  ) {
    return attached.phaseEnteredAt;
  }
  return undefined;
};
