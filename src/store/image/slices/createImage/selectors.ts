import { ImageStore } from '../../store';

const isCreating = (state: ImageStore) => state.isCreating;
const isCreatingWithNewTopic = (state: ImageStore) => state.isCreatingWithNewTopic;
const isBatchRegenerating = (batchId: string) => (state: ImageStore) =>
  state.regeneratingBatchIds.includes(batchId);

export const createImageSelectors = {
  isBatchRegenerating,
  isCreating,
  isCreatingWithNewTopic,
};
