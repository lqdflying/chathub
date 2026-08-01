import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

const { agentStoreMock } = vi.hoisted(() => {
  const state = {
    activeId: 'session-1',
    enableAssistantMemory: true,
    fixedMemory: '' as string | null,
    internal_updateAgentConfig: vi.fn(async (_id: string, patch: any) => {
      state.fixedMemory = patch.fixedMemory;
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
    getAgentConfigById: () => () => ({ fixedMemory: agentStoreMock.fixedMemory }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  agentStoreMock.activeId = 'session-1';
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
});
