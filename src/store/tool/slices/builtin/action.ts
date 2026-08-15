import { StateCreator } from 'zustand/vanilla';

import { DallEImageItem } from '@/types/tool/dalle';
import { setNamespace } from '@/utils/storeDebug';

import { ToolStore } from '../../store';

const n = setNamespace('builtinTool');

interface Text2ImageParams {
  prompts: string[];
}

/**
 * 代理行为接口
 */
export interface BuiltinToolAction {
  text2image: (params: Text2ImageParams) => DallEImageItem[];
  toggleBuiltinToolLoading: (key: string, value: boolean) => void;
  transformApiArgumentsToAiState: (
    key: string,
    params: any,
    invocationIsCurrent?: () => boolean,
  ) => Promise<string | undefined>;
}

export const createBuiltinToolSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  BuiltinToolAction
> = (set, get) => ({
  text2image: ({ prompts }) => prompts.map((p) => ({ prompt: p })),
  toggleBuiltinToolLoading: (key, value) => {
    set({ builtinToolLoading: { [key]: value } }, false, n('toggleBuiltinToolLoading'));
  },

  transformApiArgumentsToAiState: async (key, params, invocationIsCurrent) => {
    const { builtinToolLoading, toggleBuiltinToolLoading } = get();
    if (builtinToolLoading[key]) return;

    const { [key as keyof BuiltinToolAction]: action } = get();

    if (!action) return JSON.stringify(params);

    toggleBuiltinToolLoading(key, true);

    try {
      // @ts-ignore
      const result = await action(params);
      if (invocationIsCurrent?.() === false) return;

      toggleBuiltinToolLoading(key, false);

      return JSON.stringify(result);
    } catch (e) {
      if (invocationIsCurrent?.() === false) throw e;

      toggleBuiltinToolLoading(key, false);
      throw e;
    }
  },
});
