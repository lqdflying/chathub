import { nanoid } from 'nanoid';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

export interface PastedTextItem {
  content: string;
  id: string;
}

interface PastedTextState {
  addPastedText: (content: string) => string;
  clearPastedTexts: () => void;
  items: PastedTextItem[];
  removePastedText: (id: string) => void;
}

export const usePastedTextStore = createWithEqualityFn<PastedTextState>()(
  (set) => ({
    addPastedText: (content) => {
      const id = nanoid();
      set((state) => ({
        items: [...state.items, { content, id }],
      }));
      return id;
    },
    clearPastedTexts: () => {
      set({ items: [] });
    },
    items: [],
    removePastedText: (id) => {
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
      }));
    },
  }),
  shallow,
);

export const getPastedTextStoreState = () => usePastedTextStore.getState();
