import { ImageStore } from '../../store';

const isCreating = (state: ImageStore) => state.isCreating;
const isBatchRegenerating = (batchId: string) => (state: ImageStore) =>
  state.regeneratingBatchIds.includes(batchId);

export const createImageSelectors = {
  isBatchRegenerating,
  isCreating,
};
