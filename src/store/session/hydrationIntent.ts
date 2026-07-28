let assistantHydrationCancellationGeneration = 0;

export const cancelPendingAssistantHydration = (): number => {
  assistantHydrationCancellationGeneration += 1;
  return assistantHydrationCancellationGeneration;
};

export const getAssistantHydrationCancellationGeneration = (): number =>
  assistantHydrationCancellationGeneration;
