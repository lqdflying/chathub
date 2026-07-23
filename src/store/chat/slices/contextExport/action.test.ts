import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';
import { initialContextExportState } from '@/store/chat/slices/contextExport/initialState';

describe('chatContextExport', () => {
  beforeEach(() => {
    useChatStore.setState(initialContextExportState);
  });

  it('arms and consumes a capture once', () => {
    const { result } = renderHook(() => useChatStore());
    const allocation = {
      chatInstruction: 12,
      chatMessages: 42,
      roleSettings: 8,
      total: 62,
    };

    act(() => {
      result.current.armContextExport(allocation);
    });

    expect(result.current.contextExportCaptureStatus).toBe('armed');

    let captureId: string | undefined;
    act(() => {
      captureId = result.current.consumeContextExportArm();
    });

    expect(captureId).toMatch(/^context_/);
    expect(result.current.contextExportBatch?.captureId).toBe(captureId);
    expect(result.current.contextExportCaptureStatus).toBe('capturing');
    expect(result.current.consumeContextExportArm()).toBeUndefined();

    const request = result.current.createContextExportRequest(captureId!, 'assistant');
    expect(request?.allocation).toEqual(allocation);
  });

  it('cancels an armed capture without creating a batch', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.cancelContextExport();
    });

    expect(result.current.contextExportBatch).toBeUndefined();
    expect(result.current.contextExportCaptureStatus).toBe('idle');
  });

  it('cancels an active capture as a viewable partial batch', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.consumeContextExportArm();
    });

    const captureId = result.current.contextExportBatch!.captureId;
    const request = result.current.createContextExportRequest(captureId, 'assistant');

    act(() => {
      result.current.appendContextExportSnapshot({
        ...request!,
        engineeredInput: { messages: ['captured'] },
        redactions: [],
        status: 'capturing',
      });
      result.current.cancelContextExport();
    });

    expect(result.current.contextExportCaptureStatus).toBe('ready');
    expect(result.current.contextExportBatch).toMatchObject({
      captureId,
      status: 'partial',
    });
    expect(result.current.contextExportBatch?.requests[0]).toMatchObject({
      engineeredInput: { messages: ['captured'] },
      status: 'partial',
    });

    act(() => {
      result.current.appendContextExportSnapshot({
        ...request!,
        providerRequest: { input: ['late'] },
        redactions: [],
        status: 'complete',
      });
    });

    expect(result.current.contextExportBatch?.requests[0]).not.toHaveProperty('providerRequest');
    expect(result.current.contextExportBatch?.requests[0].status).toBe('partial');
  });

  it('creates ordered request contexts and merges snapshot layers', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.consumeContextExportArm();
    });

    const captureId = result.current.contextExportBatch!.captureId;
    const firstRequest = result.current.createContextExportRequest(captureId, 'assistant');
    const secondRequest = result.current.createContextExportRequest(captureId, 'member', 'tool');

    expect(firstRequest?.sequence).toBe(0);
    expect(secondRequest?.sequence).toBe(1);

    act(() => {
      result.current.appendContextExportSnapshot({
        ...secondRequest!,
        engineeredInput: { messages: ['second'] },
        redactions: ['messageIds'],
        status: 'capturing',
      });
      result.current.appendContextExportSnapshot({
        ...firstRequest!,
        engineeredInput: { messages: ['first'] },
        redactions: ['messageIds'],
        status: 'capturing',
      });
      result.current.appendContextExportSnapshot({
        ...firstRequest!,
        providerRequest: { input: ['first'] },
        redactions: ['transportOptions'],
        status: 'complete',
      });
    });

    expect(result.current.contextExportBatch?.requests.map((request) => request.sequence)).toEqual([
      0, 1,
    ]);
    expect(result.current.contextExportBatch?.requests[0]).toMatchObject({
      engineeredInput: { messages: ['first'] },
      providerRequest: { input: ['first'] },
      redactions: ['messageIds', 'transportOptions'],
      status: 'complete',
    });
  });

  it('marks incomplete requests and batches as partial', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.consumeContextExportArm();
    });

    const captureId = result.current.contextExportBatch!.captureId;
    const request = result.current.createContextExportRequest(captureId, 'supervisor');

    act(() => {
      result.current.appendContextExportSnapshot({
        ...request!,
        engineeredInput: { messages: [] },
        redactions: [],
        status: 'capturing',
      });
      result.current.completeContextExport();
    });

    expect(result.current.contextExportBatch?.status).toBe('partial');
    expect(result.current.contextExportBatch?.requests[0].status).toBe('partial');
    expect(result.current.contextExportCaptureStatus).toBe('ready');
    expect(result.current.contextExportAllocation).toBeUndefined();
  });

  it('marks an empty completed capture as partial', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.consumeContextExportArm();
    });

    const captureId = result.current.contextExportBatch!.captureId;

    act(() => {
      result.current.completeContextExport(captureId);
    });

    expect(result.current.contextExportBatch?.status).toBe('partial');
    expect(result.current.contextExportCaptureStatus).toBe('ready');
  });

  it('does not let a stale capture id complete the active batch', () => {
    const { result } = renderHook(() => useChatStore());

    act(() => {
      result.current.armContextExport();
      result.current.consumeContextExportArm();
      result.current.completeContextExport('stale-capture');
    });

    expect(result.current.contextExportCaptureStatus).toBe('capturing');
    expect(result.current.contextExportBatch?.status).toBe('capturing');
  });
});

