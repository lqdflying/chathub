import { describe, expect, it } from 'vitest';

import { merge } from '@/utils/merge';

import { ImageStore } from '../../store';
import { initialCreateImageState } from './initialState';
import { createImageSelectors } from './selectors';

// 创建一个最小的 ImageStore 模拟对象
const createMockImageStore = (overrides?: Partial<ImageStore>): ImageStore => {
  return merge(
    {
      ...initialCreateImageState,
      // 其他必要的初始状态
    } as ImageStore,
    overrides || {},
  );
};

describe('createImageSelectors', () => {
  describe('isBatchRegenerating', () => {
    it('should match only the batch with an active regeneration', () => {
      const state = createMockImageStore({ regeneratingBatchIds: ['batch-2'] });

      expect(createImageSelectors.isBatchRegenerating('batch-1')(state)).toBe(false);
      expect(createImageSelectors.isBatchRegenerating('batch-2')(state)).toBe(true);
    });
  });

  describe('isCreating', () => {
    it('should return false from initial state', () => {
      const state = createMockImageStore();

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(false);
    });

    it('should return true when isCreating is true', () => {
      const state = createMockImageStore({ isCreating: true });

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(true);
    });

    it('should return false when isCreating is explicitly set to false', () => {
      const state = createMockImageStore({ isCreating: false });

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(false);
    });
  });
});
