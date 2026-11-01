/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { buildSandboxSessionKey } from '../session';

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

describe('buildSandboxSessionKey with Sandbox Hub profiles', () => {
  // The key every parked sandbox carried before profiles existed.
  const legacyKey = createHash('sha256')
    .update(JSON.stringify(['user-1', null, 'agent-1', 'topic-1', null]))
    .digest('hex')
    .slice(0, 32);

  it('keeps the general profile on the pre-profile key so parked sandboxes are reused', () => {
    expect(buildSandboxSessionKey(base)).toBe(legacyKey);
    expect(buildSandboxSessionKey({ ...base, profileId: 'general' })).toBe(legacyKey);
    expect(buildSandboxSessionKey({ ...base, profileId: null })).toBe(legacyKey);
  });

  it('gives every other profile its own key in the same conversation', () => {
    const data = buildSandboxSessionKey({ ...base, profileId: 'data' });
    const web = buildSandboxSessionKey({ ...base, profileId: 'web' });
    expect(new Set([legacyKey, data, web]).size).toBe(3);
    expect(data).toMatch(/^[\da-f]{32}$/);
  });
});
