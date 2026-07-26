import { ThreadItem, ThreadType } from '@/types/topic';

import type { TitleSummaryOperation } from '../../types';

export interface ChatThreadState {
  activeThreadId?: string;
  /**
   * is creating thread with service call
   */
  isCreatingThread?: boolean;
  isCreatingThreadMessage?: boolean;
  newThreadMode: ThreadType;
  /**
   * if true it mean to start to fork a new thread
   */
  startToForkThread?: boolean;

  threadInputMessage: string;
  threadLoadingIds: string[];
  threadMaps: Record<string, ThreadItem[]>;
  threadMessageSendingId?: string;
  threadRenamingId?: string;
  /**
   * when open thread creator, set the message id to it
   */
  threadStartMessageId?: string;
  threadTitleSummaryOperations: Record<string, TitleSummaryOperation>;
  threadsInit?: boolean;
}

export const initialThreadState: ChatThreadState = {
  isCreatingThread: false,
  newThreadMode: ThreadType.Continuation,
  threadInputMessage: '',
  threadLoadingIds: [],
  threadMaps: {},
  threadTitleSummaryOperations: {},
  threadsInit: false,
};
