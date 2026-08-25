/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isCompactionDebugClientEnabled,
  logCompactionWatcherArmed,
} from '../compactionDebugClient';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    conversationGeneration: {
      reportCompactionDebug: { mutate: vi.fn().mockResolvedValue({ accepted: 1 }) },
    },
  },
}));

const STORAGE_KEY = 'chathub.compactionDebug';

const setServerFlag = (value?: boolean) => {
  (
    window as unknown as {
      global_serverConfigStore?: {
        getState: () => { serverConfig?: { compactionDebug?: boolean } };
      };
    }
  ).global_serverConfigStore = {
    getState: () => ({ serverConfig: { compactionDebug: value } }),
  };
};

describe('compaction debug client gating', () => {
  beforeEach(() => {
    localStorage.clear();
    setServerFlag(false);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('follows the server flag when localStorage is unset', () => {
    expect(isCompactionDebugClientEnabled()).toBe(false);
    setServerFlag(true);
    expect(isCompactionDebugClientEnabled()).toBe(true);
  });

  it('force-off localStorage wins over a server flag that is on', () => {
    setServerFlag(true);
    localStorage.setItem(STORAGE_KEY, 'off');
    expect(isCompactionDebugClientEnabled()).toBe(false);
  });

  it('force-on localStorage wins over a server flag that is off', () => {
    setServerFlag(false);
    localStorage.setItem(STORAGE_KEY, '1');
    expect(isCompactionDebugClientEnabled()).toBe(true);
  });

  it('does not hash identifiers when watcher diagnostics are force-off', async () => {
    setServerFlag(true);
    localStorage.setItem(STORAGE_KEY, '0');
    const digestSpy = vi.spyOn(crypto.subtle, 'digest');

    await logCompactionWatcherArmed({
      highWatermark: 0.8,
      knowledgeBaseToken: 40,
      maxTokens: 1000,
      ratio: 0.9,
      sessionId: 'session-private',
      topicId: 'topic-private',
      totalToken: 900,
    });

    expect(digestSpy).not.toHaveBeenCalled();
  });

  it('hashes identifiers when watcher diagnostics are force-on', async () => {
    setServerFlag(false);
    localStorage.setItem(STORAGE_KEY, 'on');
    const digestSpy = vi.spyOn(crypto.subtle, 'digest');

    await logCompactionWatcherArmed({
      highWatermark: 0.8,
      knowledgeBaseToken: 40,
      maxTokens: 1000,
      ratio: 0.9,
      sessionId: 'session-private',
      topicId: 'topic-private',
      totalToken: 900,
    });

    expect(digestSpy).toHaveBeenCalled();
  });
});
