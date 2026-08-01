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
