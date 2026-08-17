import { afterEach, describe, expect, it } from 'vitest';

import { isClientDurableConversationGenerationEnabled } from '../durableConversationGeneration';

describe('isClientDurableConversationGenerationEnabled', () => {
  afterEach(() => {
    delete (window as any).global_serverConfigStore;
  });

  it('is false when the server config store is missing', () => {
    expect(isClientDurableConversationGenerationEnabled()).toBe(false);
  });

  it('reads only the hydrated server feature flag', () => {
    (window as any).global_serverConfigStore = {
      getState: () => ({
        featureFlags: { enableDurableConversationGeneration: true },
      }),
    };

    expect(isClientDurableConversationGenerationEnabled()).toBe(true);
  });
});
