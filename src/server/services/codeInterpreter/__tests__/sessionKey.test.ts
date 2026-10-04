/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { buildSandboxSessionKey } from '../index';

vi.mock('@/server/services/sandbox', () => ({}));

const base = { sessionId: 'agent-1', topicId: 'topic-1', userId: 'user-1' };

describe('buildSandboxSessionKey', () => {
  it('is stable per conversation and hides the raw ids', () => {
    const key = buildSandboxSessionKey(base);

    expect(key).toMatch(/^[\da-f]{32}$/);
    expect(buildSandboxSessionKey({ ...base })).toBe(key);
  });

  it('separates users, agents, groups, topics, and portal threads', () => {
    const keys = [
      buildSandboxSessionKey(base),
      buildSandboxSessionKey({ ...base, userId: 'user-2' }),
      buildSandboxSessionKey({ ...base, sessionId: 'agent-2' }),
      buildSandboxSessionKey({ ...base, groupId: 'group-1' }),
      buildSandboxSessionKey({ ...base, topicId: 'topic-2' }),
      buildSandboxSessionKey({ ...base, threadId: 'thread-1' }),
      buildSandboxSessionKey({ ...base, topicId: null }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('treats the inbox id like no session, as conversation files do', () => {
    expect(buildSandboxSessionKey({ ...base, sessionId: 'inbox' })).toBe(
      buildSandboxSessionKey({ ...base, sessionId: null }),
    );
    expect(buildSandboxSessionKey({ ...base, threadId: '' })).toBe(buildSandboxSessionKey(base));
  });
});
