import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryEntryOriginKey } from '@/helpers/assistantMemory';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const { agentStoreMock } = vi.hoisted(() => {
  const state = {
    activeId: 'session-1',
    assistantMemory: '' as string | null,
    assistantMemoryMeta: undefined as any,
    enableAssistantMemory: true,
    fixedMemory: '' as string | null,
    internal_updateAgentConfig: vi.fn(async (_id: string, patch: any) => {
      state.fixedMemory = patch.fixedMemory;
      if (patch.assistantMemoryMeta) state.assistantMemoryMeta = patch.assistantMemoryMeta;
    }),
  };
  return { agentStoreMock: state };
});

vi.mock('@/store/agent/store', () => ({
  getAgentStoreState: () => agentStoreMock,
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    enableAssistantMemory: () => agentStoreMock.enableAssistantMemory,
  },
  agentSelectors: {
    getAgentConfigById: () => () => ({
      assistantMemory: agentStoreMock.assistantMemory,
      assistantMemoryMeta: agentStoreMock.assistantMemoryMeta,
      fixedMemory: agentStoreMock.fixedMemory,
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({ messagesMap: {} });
  agentStoreMock.activeId = 'session-1';
  agentStoreMock.assistantMemory = '';
  agentStoreMock.assistantMemoryMeta = undefined;
  agentStoreMock.enableAssistantMemory = true;
  agentStoreMock.fixedMemory = '';
});

describe('saveMemory builtin tool executor', () => {
  it('appends a numbered entry and reports the result', async () => {
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.saveMemory('msg-1', { content: 'likes tea' });
    });

    expect(outcome).toBe(true);
    expect(agentStoreMock.internal_updateAgentConfig).toHaveBeenCalledWith('session-1', {
      assistantMemoryMeta: {
        entryOrigins: { [memoryEntryOriginKey('likes tea')]: 'agent' },
      },
      fixedMemory: '#1: likes tea',
    });
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({ content: 'likes tea', index: 1, saved: true }),
    );

    updateContent.mockRestore();
  });

  it('serializes concurrent saves so numbering stays monotonic and lossless', async () => {
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await Promise.all([
        result.current.saveMemory('msg-1', { content: 'first' }),
        result.current.saveMemory('msg-2', { content: 'second' }),
      ]);
    });

    expect(agentStoreMock.fixedMemory).toBe('#1: first\n#2: second');
    expect(agentStoreMock.internal_updateAgentConfig).toHaveBeenCalledTimes(2);

    updateContent.mockRestore();
  });

  it('reports a plugin error when memory is disabled and writes nothing', async () => {
    agentStoreMock.enableAssistantMemory = false;
    const { result } = renderHook(() => useChatStore());
    const pluginError = vi
      .spyOn(result.current, 'internal_updatePluginError')
      .mockResolvedValue(undefined as any);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.saveMemory('msg-1', { content: 'x' });
    });

    expect(outcome).toBe(true);
    expect(agentStoreMock.internal_updateAgentConfig).not.toHaveBeenCalled();
    expect(pluginError).toHaveBeenCalled();

    pluginError.mockRestore();
  });

  it('reports a plugin error on empty content', async () => {
    const { result } = renderHook(() => useChatStore());
    const pluginError = vi
      .spyOn(result.current, 'internal_updatePluginError')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.saveMemory('msg-1', { content: '   ' });
    });

    expect(agentStoreMock.internal_updateAgentConfig).not.toHaveBeenCalled();
    expect(pluginError).toHaveBeenCalled();

    pluginError.mockRestore();
  });

  it('updateMemory rewrites the verified entry', async () => {
    agentStoreMock.fixedMemory = '#1: likes tea\n#2: uses pnpm';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.updateMemory('msg-1', { content: 'uses bun', index: 2, match: 'pnpm' });
    });

    expect(agentStoreMock.fixedMemory).toBe('#1: likes tea\n#2: uses bun');
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({ content: 'uses bun', index: 2, updated: true }),
    );

    updateContent.mockRestore();
  });

  it('updateMemory mismatch returns the current entries as tool result, not a plugin error', async () => {
    agentStoreMock.fixedMemory = '#1: likes tea';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);
    const pluginError = vi
      .spyOn(result.current, 'internal_updatePluginError')
      .mockResolvedValue(undefined as any);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.updateMemory('msg-1', {
        content: 'x',
        index: 1,
        match: 'coffee',
      });
    });

    expect(outcome).toBe(true);
    expect(agentStoreMock.fixedMemory).toBe('#1: likes tea');
    expect(agentStoreMock.internal_updateAgentConfig).not.toHaveBeenCalled();
    expect(pluginError).not.toHaveBeenCalled();
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({ currentEntries: '#1: likes tea', error: 'mismatch' }),
    );

    updateContent.mockRestore();
    pluginError.mockRestore();
  });

  it('deleteMemory removes the entry and renumbers the remainder', async () => {
    agentStoreMock.fixedMemory = '#1: a\n#2: b\n#3: c';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.deleteMemory('msg-1', { index: 2, match: 'b' });
    });

    expect(agentStoreMock.fixedMemory).toBe('#1: a\n#2: c');
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({ deleted: true, index: 2, renumbered: true }),
    );

    updateContent.mockRestore();
  });

  it('serializes mixed save/update/delete operations', async () => {
    agentStoreMock.fixedMemory = '#1: a\n#2: b';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await Promise.all([
        result.current.deleteMemory('m1', { index: 1, match: 'a' }),
        result.current.saveMemory('m2', { content: 'c' }),
        result.current.updateMemory('m3', { content: 'B', index: 1, match: 'b' }),
      ]);
    });

    // delete #1(a) → doc '#1: b'; save appends '#2: c'; update #1 (b→B)
    expect(agentStoreMock.fixedMemory).toBe('#1: B\n#2: c');

    updateContent.mockRestore();
  });

  it('surfaces write failures as plugin errors without breaking later saves', async () => {
    const { result } = renderHook(() => useChatStore());
    const pluginError = vi
      .spyOn(result.current, 'internal_updatePluginError')
      .mockResolvedValue(undefined as any);
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    agentStoreMock.internal_updateAgentConfig.mockRejectedValueOnce(new Error('db down'));

    await act(async () => {
      await result.current.saveMemory('msg-1', { content: 'will fail' });
      await result.current.saveMemory('msg-2', { content: 'will succeed' });
    });

    expect(pluginError).toHaveBeenCalledTimes(1);
    expect(agentStoreMock.fixedMemory).toBe('#1: will succeed');

    pluginError.mockRestore();
    updateContent.mockRestore();
  });

  it('searchMemory returns ranked hits across both tiers without writing', async () => {
    agentStoreMock.fixedMemory = '#1: prefers dark mode\n#2: drinks green tea';
    agentStoreMock.assistantMemory = '#1 [2026-09-01]:\n discussed tea brewing times';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.searchMemory('msg-1', { query: 'tea' });
    });

    expect(outcome).toBe(true);
    expect(agentStoreMock.internal_updateAgentConfig).not.toHaveBeenCalled();
    const payload = JSON.parse(updateContent.mock.calls[0][1] as string);
    expect(payload.hits).toHaveLength(2);
    expect(payload.hits.map((hit: any) => hit.source).sort()).toEqual(['dynamic', 'fixed']);

    updateContent.mockRestore();
  });

  it('searchMemory returns an error tool result on empty query', async () => {
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);
    const pluginError = vi
      .spyOn(result.current, 'internal_updatePluginError')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.searchMemory('msg-1', { query: '  ' });
    });

    expect(pluginError).not.toHaveBeenCalled();
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({ error: 'searchMemory requires a non-empty query' }),
    );

    updateContent.mockRestore();
    pluginError.mockRestore();
  });

  it('readMemory returns both tiers as tool result content', async () => {
    agentStoreMock.fixedMemory = '#1: prefers dark mode';
    agentStoreMock.assistantMemory = '#1 [2026-09-01]:\nsummary body';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.readMemory('msg-1');
    });

    expect(outcome).toBe(true);
    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({
        dynamic: '#1 [2026-09-01]:\nsummary body',
        fixed: '#1: prefers dark mode',
        totalChars: '#1: prefers dark mode'.length + '#1 [2026-09-01]:\nsummary body'.length,
      }),
    );

    updateContent.mockRestore();
  });

  it('readMemory with source+index returns the single complete entry (F7)', async () => {
    agentStoreMock.fixedMemory = '#1: prefers dark mode\n#2: drinks green tea daily';
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.readMemory('msg-1', { index: 2, source: 'fixed' });
    });

    expect(updateContent).toHaveBeenCalledWith(
      'msg-1',
      JSON.stringify({
        content: 'drinks green tea daily',
        index: 2,
        source: 'fixed',
        truncated: false,
      }),
    );

    updateContent.mockRestore();
  });

  it('tags memory-tool writes as agent origin', async () => {
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.saveMemory('msg-1', { content: 'likes tea' });
    });

    expect(agentStoreMock.assistantMemoryMeta?.entryOrigins).toEqual({
      [memoryEntryOriginKey('likes tea')]: 'agent',
    });

    updateContent.mockRestore();
  });

  it('downgrades the origin to untrusted when recent history contains MCP tool output', async () => {
    const { result } = renderHook(() => useChatStore());
    // F2: taint scans the INVOKING conversation's raw history in messagesMap —
    // display selectors strip tool rows, so seed the map with the tool message
    // and the invoking assistant row ('msg-1') in the same conversation.
    act(() => {
      useChatStore.setState({
        messagesMap: {
          [messageMapKey('session-1', 'topic-1')]: [
            { id: 'u1', role: 'user' },
            { id: 't1', plugin: { identifier: 'mcp__notion' }, role: 'tool' },
            { id: 'msg-1', role: 'assistant' },
          ] as any,
        },
      });
    });
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.saveMemory('msg-1', { content: 'attacker controlled note' });
    });

    expect(agentStoreMock.assistantMemoryMeta?.entryOrigins).toEqual({
      [memoryEntryOriginKey('attacker controlled note')]: 'untrusted',
    });

    updateContent.mockRestore();
    act(() => {
      useChatStore.setState({ messagesMap: {} });
    });
  });

  it('falls back to the active raw history when the invoking row is not in any loaded map', async () => {
    // Deferred-lane case: the tool message id is not in messagesMap (e.g. the
    // conversation was never loaded in this tab), so the taint scan uses the
    // active conversation's raw history (mainAIChats keeps tool rows).
    const chatsSpy = vi.spyOn(chatSelectors, 'mainAIChats').mockReturnValue([
      { id: 't1', plugin: { identifier: 'mcp__notion' }, role: 'tool' },
      { id: 'a1', role: 'assistant' },
    ] as any);
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.saveMemory('msg-9', { content: 'attacker controlled note' });
    });

    expect(agentStoreMock.assistantMemoryMeta?.entryOrigins).toEqual({
      [memoryEntryOriginKey('attacker controlled note')]: 'untrusted',
    });

    updateContent.mockRestore();
    chatsSpy.mockRestore();
  });

  it('keeps existing origins when a later write adds another entry', async () => {
    agentStoreMock.fixedMemory = '#1: owner fact';
    agentStoreMock.assistantMemoryMeta = {
      entryOrigins: { [memoryEntryOriginKey('owner fact')]: 'owner' },
    };
    const { result } = renderHook(() => useChatStore());
    const updateContent = vi
      .spyOn(result.current, 'internal_updateMessageContent')
      .mockResolvedValue(undefined as any);

    await act(async () => {
      await result.current.saveMemory('msg-1', { content: 'agent note' });
    });

    expect(agentStoreMock.assistantMemoryMeta?.entryOrigins).toEqual({
      [memoryEntryOriginKey('owner fact')]: 'owner',
      [memoryEntryOriginKey('agent note')]: 'agent',
    });

    updateContent.mockRestore();
  });
});
