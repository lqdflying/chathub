import { TraceEventType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeaderWithAuth } from '@/services/_auth';
import { API_ENDPOINTS } from '@/services/_url';
import { preferenceSelectors } from '@/store/user/selectors';

import { traceService } from '../trace';

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: vi.fn(async () => ({
    'X-lobe-chat-auth': 'encrypted-payload',
  })),
}));

describe('TraceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(preferenceSelectors, 'userAllowTrace').mockReturnValue(true);
  });

  it('sends trace mutations with the standard encrypted auth header', async () => {
    const payload = {
      content: 'message',
      eventType: TraceEventType.CopyMessage,
      observationId: 'observation-a',
      traceId: 'trace-a',
    };

    await traceService.traceEvent(payload);

    expect(createHeaderWithAuth).toHaveBeenCalledWith({
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetch).toHaveBeenCalledWith(API_ENDPOINTS.trace, {
      body: JSON.stringify(payload),
      headers: { 'X-lobe-chat-auth': 'encrypted-payload' },
      method: 'POST',
    });
  });

  it('does not generate credentials or send requests when tracing is disabled', async () => {
    vi.mocked(preferenceSelectors.userAllowTrace).mockReturnValue(false);

    await traceService.traceEvent({
      content: 'message',
      eventType: TraceEventType.CopyMessage,
      observationId: 'observation-a',
      traceId: 'trace-a',
    });

    expect(createHeaderWithAuth).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
