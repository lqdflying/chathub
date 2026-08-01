import { StateCreator } from 'zustand/vanilla';

import { ChatStore } from '@/store/chat/store';

import { ChatDallEAction, dalleSlice } from './dalle';
import { ChatCodeInterpreterAction, codeInterpreterSlice } from './interpreter';
import { LocalFileAction, localSystemSlice } from './localSystem';
import { MemoryAction, memorySlice } from './memory';
import { MinimaxVisionAction, minimaxVisionSlice } from './minimaxVision';
import { SearchAction, searchSlice } from './search';

export interface ChatBuiltinToolAction
  extends
    ChatDallEAction,
    SearchAction,
    LocalFileAction,
    ChatCodeInterpreterAction,
    MinimaxVisionAction,
    MemoryAction {}

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (...params) => ({
  ...dalleSlice(...params),
  ...searchSlice(...params),
  ...localSystemSlice(...params),
  ...codeInterpreterSlice(...params),
  ...minimaxVisionSlice(...params),
  ...memorySlice(...params),
});
