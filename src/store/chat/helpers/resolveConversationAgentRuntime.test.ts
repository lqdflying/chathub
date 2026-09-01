import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useSessionStore } from '@/store/session';

import {
  getEnabledKnowledgeFromConfig,
  resolveConversationAgentRuntime,
  resolveEnableHistoryCountForAgent,
} from './resolveConversationAgentRuntime';

describe('resolveConversationAgentRuntime', () => {
  beforeEach(() => {
    useAgentStore.setState(
      {
        agentMap: {
          'session-a': {
            chatConfig: { enableCompressHistory: true, enableHistoryCount: true, searchMode: 'off' },
            knowledgeBases: [{ enabled: true, id: 'kb-a', name: 'A KB' }],
            model: 'kimi-k2.7-code',
            provider: 'moonshot',
            systemRole: 'agent A system',
          },
          'session-b': {
            chatConfig: { enableHistoryCount: false, searchMode: 'off' },
            model: 'mimo-v2.5-pro',
            provider: 'mimo',
            systemRole: 'agent B system',
          },
        },
        defaultAgentConfig: { model: 'fallback', provider: 'openai' },
      } as any,
      false,
    );
    useSessionStore.setState(
      {
        sessions: [
          { id: 'session-a', type: 'agent' },
          { id: 'session-b', type: 'agent' },
        ],
      } as any,
      false,
    );
    useAgentStore.setState({ activeId: 'session-b' } as any, false);
  });

  it('resolves the originating session config while another session is active', () => {
    const runtime = resolveConversationAgentRuntime('session-a');

    expect(runtime.agentConfig.model).toBe('kimi-k2.7-code');
    expect(runtime.agentConfig.provider).toBe('moonshot');
    expect(runtime.systemRole).toBe('agent A system');
    expect(runtime.chatConfig.enableHistoryCount).toBe(true);
    expect(runtime.enableHistoryCount).toBe(true);
    expect(runtime.isGroupSession).toBe(false);
    expect(runtime.enabledKnowledge).toEqual([
      { id: 'kb-a', name: 'A KB', type: 'knowledgeBase' },
    ]);
  });

  it('marks group sessions from session store type', () => {
    useSessionStore.setState(
      {
        sessions: [{ id: 'session-a', type: 'group' }],
      } as any,
      false,
    );

    expect(resolveConversationAgentRuntime('session-a').isGroupSession).toBe(true);
  });
});

describe('resolveEnableHistoryCountForAgent', () => {
  it('returns chatConfig.enableHistoryCount when no cache/search override applies', () => {
    expect(
      resolveEnableHistoryCountForAgent({
        chatConfig: { enableHistoryCount: true, searchMode: 'off' },
        model: 'gpt-4o',
      } as any),
    ).toBe(true);
  });
});

describe('getEnabledKnowledgeFromConfig', () => {
  it('includes only enabled files and knowledge bases', () => {
    expect(
      getEnabledKnowledgeFromConfig({
        files: [
          { enabled: true, id: 'f1', name: 'a.txt', type: 'text/plain' },
          { enabled: false, id: 'f2', name: 'b.txt', type: 'text/plain' },
        ],
        knowledgeBases: [{ enabled: true, id: 'kb1', name: 'KB' }],
      } as any),
    ).toEqual([
      { fileType: 'text/plain', id: 'f1', name: 'a.txt', type: 'file' },
      { id: 'kb1', name: 'KB', type: 'knowledgeBase' },
    ]);
  });
});
