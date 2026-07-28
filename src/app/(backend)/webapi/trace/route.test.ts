// @vitest-environment node
import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, TraceEventType } from '@lobechat/types';
import { after } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWebApiAuthFromHeader } from '@/app/(backend)/middleware/auth/utils';
import { TraceClient } from '@/libs/traces';

import { POST } from './route';

const traceEventClient = vi.hoisted(() => ({
  copyMessage: vi.fn(),
  deleteAndRegenerateMessage: vi.fn(),
  modifyMessage: vi.fn(),
  regenerateMessage: vi.fn(),
}));
const createEvent = vi.hoisted(() => vi.fn(() => traceEventClient));
const shutdownAsync = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  after: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/(backend)/middleware/auth/utils')>()),
  resolveWebApiAuthFromHeader: vi.fn(),
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn(() => ({
    createEvent,
    shutdownAsync,
  })),
}));

describe('POST /webapi/trace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests before parsing or mutating trace events', async () => {
    const parseEvent = vi.fn();
    vi.mocked(resolveWebApiAuthFromHeader).mockRejectedValue(
      AgentRuntimeError.createError(ChatErrorType.Unauthorized),
    );
    const request = {
      headers: new Headers(),
      json: parseEvent,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(parseEvent).not.toHaveBeenCalled();
    expect(TraceClient).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('mutates the requested trace event after authentication succeeds', async () => {
    vi.mocked(resolveWebApiAuthFromHeader).mockResolvedValue({
      authResult: { method: 'nextAuth', userId: 'account-a' },
      payload: {},
    });
    const eventPayload = {
      content: 'updated content',
      eventType: TraceEventType.ModifyMessage,
      nextContent: 'new content',
      observationId: 'observation-a',
      traceId: 'trace-a',
    };
    const request = new Request('https://chathub.example/webapi/trace', {
      body: JSON.stringify(eventPayload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const response = await POST(request);

    expect(createEvent).toHaveBeenCalledWith('trace-a');
    expect(traceEventClient.modifyMessage).toHaveBeenCalledWith(eventPayload);
    expect(after).toHaveBeenCalledWith(expect.any(Function));
    expect(response.status).toBe(201);
  });
});
