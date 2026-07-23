import type {
  ContextExportAllocation,
  ContextExportContinuationReason,
  ContextExportPurpose,
  ContextExportRequestContext,
  ContextExportRequestSnapshot,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { produce } from 'immer';
import type { StateCreator } from 'zustand/vanilla';

import type { ChatStore } from '@/store/chat/store';

export interface ChatContextExportAction {
  appendContextExportSnapshot: (snapshot: ContextExportRequestSnapshot) => void;
  armContextExport: (allocation?: ContextExportAllocation) => void;
  cancelContextExport: () => void;
  clearContextExport: () => void;
  completeContextExport: (captureId?: string) => void;
  consumeContextExportArm: () => string | undefined;
  createContextExportRequest: (
    captureId: string,
    purpose: ContextExportPurpose,
    continuationReason?: ContextExportContinuationReason,
  ) => ContextExportRequestContext | undefined;
}

export const chatContextExport: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatContextExportAction
> = (set, get) => ({
  appendContextExportSnapshot: (snapshot) => {
    const batch = get().contextExportBatch;
    if (
      !batch ||
      batch.captureId !== snapshot.captureId ||
      get().contextExportCaptureStatus !== 'capturing'
    ) {
      return;
    }

    set(
      produce((state: ChatStore) => {
        const currentBatch = state.contextExportBatch;
        if (
          !currentBatch ||
          currentBatch.captureId !== snapshot.captureId ||
          state.contextExportCaptureStatus !== 'capturing'
        ) {
          return;
        }

        const currentIndex = currentBatch.requests.findIndex(
          (request) => request.requestId === snapshot.requestId,
        );

        if (currentIndex < 0) {
          currentBatch.requests.push(snapshot);
        } else {
          currentBatch.requests[currentIndex] = {
            ...currentBatch.requests[currentIndex],
            ...snapshot,
            redactions: [
              ...new Set([
                ...currentBatch.requests[currentIndex].redactions,
                ...snapshot.redactions,
              ]),
            ],
          };
        }

        currentBatch.requests.sort((first, second) => first.sequence - second.sequence);
      }),
      false,
      'contextExport/appendSnapshot',
    );
  },
  armContextExport: (allocation) => {
    set(
      {
        contextExportAllocation: allocation,
        contextExportBatch: undefined,
        contextExportCaptureStatus: 'armed',
        contextExportNextSequence: 0,
      },
      false,
      'contextExport/arm',
    );
  },
  cancelContextExport: () => {
    const captureStatus = get().contextExportCaptureStatus;
    const batch = get().contextExportBatch;

    if (captureStatus === 'capturing' && batch) {
      set(
        {
          contextExportAllocation: undefined,
          contextExportBatch: {
            ...batch,
            completedAt: Date.now(),
            requests: batch.requests.map((request) =>
              request.status === 'capturing' ? { ...request, status: 'partial' } : request,
            ),
            status: 'partial',
          },
          contextExportCaptureStatus: 'ready',
          contextExportNextSequence: 0,
        },
        false,
        'contextExport/cancelCapture',
      );
      return;
    }

    const isArmed = captureStatus === 'armed';
    set(
      {
        contextExportAllocation: isArmed ? undefined : get().contextExportAllocation,
        contextExportBatch: isArmed ? undefined : get().contextExportBatch,
        contextExportCaptureStatus: isArmed ? 'idle' : 'ready',
        contextExportNextSequence: 0,
      },
      false,
      'contextExport/cancel',
    );
  },
  clearContextExport: () => {
    set(
      {
        contextExportAllocation: undefined,
        contextExportBatch: undefined,
        contextExportCaptureStatus: 'idle',
        contextExportNextSequence: 0,
      },
      false,
      'contextExport/clear',
    );
  },
  completeContextExport: (captureId) => {
    const batch = get().contextExportBatch;
    if (!batch || (captureId && batch.captureId !== captureId)) return;
    if (get().contextExportCaptureStatus !== 'capturing') return;

    const hasError = batch.requests.some((request) => request.status === 'error');
    const hasNoRequests = batch.requests.length === 0;
    const hasIncompleteRequest = batch.requests.some(
      (request) => request.status === 'capturing' || !request.providerRequest,
    );
    const status = hasError || hasIncompleteRequest || hasNoRequests ? 'partial' : 'complete';

    set(
      {
        contextExportAllocation: undefined,
        contextExportBatch: {
          ...batch,
          completedAt: Date.now(),
          requests: batch.requests.map((request) =>
            request.status === 'capturing' ? { ...request, status: 'partial' } : request,
          ),
          status,
        },
        contextExportCaptureStatus: 'ready',
      },
      false,
      'contextExport/complete',
    );
  },
  consumeContextExportArm: () => {
    if (get().contextExportCaptureStatus !== 'armed') return;

    const captureId = `context_${nanoid(20)}`;
    set(
      {
        contextExportBatch: {
          captureId,
          createdAt: Date.now(),
          requests: [],
          status: 'capturing',
        },
        contextExportCaptureStatus: 'capturing',
        contextExportNextSequence: 0,
      },
      false,
      'contextExport/consumeArm',
    );

    return captureId;
  },
  createContextExportRequest: (captureId, purpose, continuationReason = 'initial') => {
    const batch = get().contextExportBatch;
    if (
      !batch ||
      batch.captureId !== captureId ||
      get().contextExportCaptureStatus !== 'capturing'
    ) {
      return;
    }

    const sequence = get().contextExportNextSequence;
    const requestContext: ContextExportRequestContext = {
      allocation: get().contextExportAllocation,
      captureId: batch.captureId,
      continuationReason,
      purpose,
      requestId: `context_request_${nanoid(20)}`,
      sequence,
    };

    set(
      { contextExportNextSequence: sequence + 1 },
      false,
      'contextExport/createRequest',
    );

    return requestContext;
  },
});

