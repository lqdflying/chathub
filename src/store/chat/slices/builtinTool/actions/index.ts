import { StateCreator } from 'zustand/vanilla';

import { ChatStore } from '@/store/chat/store';

import { ChatDallEAction, dalleSlice } from './dalle';
import { ChatCodeInterpreterAction, codeInterpreterSlice } from './interpreter';
import { LocalFileAction, localSystemSlice } from './localSystem';
import { MemoryAction, memorySlice } from './memory';
import { SearchAction, searchSlice } from './search';
import { SkillAction, skillSlice } from './skill';

export interface ChatBuiltinToolAction
  extends
    ChatDallEAction,
    SearchAction,
    LocalFileAction,
    ChatCodeInterpreterAction,
    MemoryAction,
    SkillAction {}

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
  ...memorySlice(...params),
  ...skillSlice(...params),
});
