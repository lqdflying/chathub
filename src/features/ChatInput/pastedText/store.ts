import { nanoid } from 'nanoid';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

export interface PastedTextItem {
  content: string;
  id: string;
}

const EMPTY_ITEMS: PastedTextItem[] = [];

interface PastedTextState {
  addPastedText: (scope: string, content: string) => string;
  clearAllPastedTexts: () => void;
  clearPastedTexts: (scope: string) => void;
  itemsByScope: Record<string, PastedTextItem[]>;
  removePastedText: (scope: string, id: string) => void;
}

export const selectPastedTextItems = (scope: string) => (state: PastedTextState) =>
  state.itemsByScope[scope] ?? EMPTY_ITEMS;

export const selectPastedTextCount = (scope: string) => (state: PastedTextState) =>
  state.itemsByScope[scope]?.length ?? 0;

export const usePastedTextStore = createWithEqualityFn<PastedTextState>()(
  (set) => ({
    addPastedText: (scope, content) => {
      const id = nanoid();
      set((state) => ({
        itemsByScope: {
          ...state.itemsByScope,
          [scope]: [...(state.itemsByScope[scope] ?? []), { content, id }],
        },
      }));
      return id;
    },
    clearAllPastedTexts: () => {
      set({ itemsByScope: {} });
    },
    clearPastedTexts: (scope) => {
      set((state) => {
        if (!(scope in state.itemsByScope)) return state;
        const itemsByScope = { ...state.itemsByScope };
        delete itemsByScope[scope];
        return { itemsByScope };
      });
    },
    itemsByScope: {},
    removePastedText: (scope, id) => {
      set((state) => {
        const items = state.itemsByScope[scope];
        if (!items) return state;
        return {
          itemsByScope: {
            ...state.itemsByScope,
            [scope]: items.filter((item) => item.id !== id),
          },
        };
      });
    },
  }),
  shallow,
);

export const getPastedTextStoreState = () => usePastedTextStore.getState();
