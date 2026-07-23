import type { ContextExportAllocation, ContextExportBatch } from '@lobechat/types';

export type ContextExportCaptureStatus = 'armed' | 'capturing' | 'idle' | 'ready';

export interface ChatContextExportState {
  contextExportAllocation?: ContextExportAllocation;
  contextExportBatch?: ContextExportBatch;
  contextExportCaptureStatus: ContextExportCaptureStatus;
  contextExportNextSequence: number;
}

export const initialContextExportState: ChatContextExportState = {
  contextExportAllocation: undefined,
  contextExportCaptureStatus: 'idle',
  contextExportNextSequence: 0,
};

