import { StateCreator } from 'zustand/vanilla';

import { ChatStore } from '@/store/chat/store';

import { ChatDallEAction, dalleSlice } from './dalle';
import { MemoryAction, memorySlice } from './memory';
import { ChatSandboxAction, sandboxSlice } from './sandbox';
import { SearchAction, searchSlice } from './search';

export interface ChatBuiltinToolAction
  extends ChatDallEAction, SearchAction, ChatSandboxAction, MemoryAction {}

export const chatToolSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatBuiltinToolAction
> = (...params) => ({
  ...dalleSlice(...params),
  ...searchSlice(...params),
  ...sandboxSlice(...params),
  ...memorySlice(...params),
});
