import { createHeaderWithAuth } from '@/services/_auth';
import { API_ENDPOINTS } from '@/services/_url';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { TraceEventBasePayload, TraceEventPayloads } from '@/types/trace';

class TraceService {
  private request = async <T>(data: T) => {
    try {
      const headers = await createHeaderWithAuth({
        headers: { 'Content-Type': 'application/json' },
      });

      return fetch(API_ENDPOINTS.trace, {
        body: JSON.stringify(data),
        headers,
        method: 'POST',
      });
    } catch (e) {
      console.error(e);
    }
  };

  traceEvent = async (data: TraceEventPayloads & TraceEventBasePayload) => {
    const enabled = preferenceSelectors.userAllowTrace(useUserStore.getState());

    if (!enabled) return;

    return this.request(data);
  };
}

export const traceService = new TraceService();
