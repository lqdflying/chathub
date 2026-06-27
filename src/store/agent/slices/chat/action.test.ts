import { act, renderHook, waitFor } from '@testing-library/react';
import {
  ASSISTANT_MEMORY_MAX_CHARS,
  ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
} from '@lobechat/prompts';
import { mutate } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { chatService } from '@/services/chat';
import { globalService } from '@/services/global';
import { sessionService } from '@/services/session';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSessionStore } from '@/store/session';

vi.mock('zustand/traditional', async () => {
  return await vi.importActual('zustand/traditional');
});
vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));
vi.mock('@/services/topic', () => ({
  topicService: {
    listTopicsForAgentMemoryRollup: vi.fn(),
  },
}));
vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({}),
  useElectronStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({})),
    setState: vi.fn(),
  }),
}));
vi.mock('@/store/electron/selectors', () => ({
  electronSyncSelectors: {
    isSyncActive: () => false,
  },
}));
vi.mock('swr', async (importOriginal) => {
  const origin = await importOriginal();
  return {
    ...(origin as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useAgentStore.setState({
    activeAgentId: undefined,
    activeId: INBOX_SESSION_ID,
    agentConfigInitMap: {},
    agentMap: {},
    isInboxAgentConfigInit: false,
  } as any);
});

describe('AgentSlice', () => {
  describe('removePlugin', () => {
    it('should call togglePlugin with the provided id and false', async () => {
      const { result } = renderHook(() => useAgentStore());
      const pluginId = 'plugin-id';
      const togglePluginMock = vi
        .spyOn(result.current, 'togglePlugin')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removePlugin(pluginId);
      });

      expect(togglePluginMock).toHaveBeenCalledWith(pluginId, false);
      togglePluginMock.mockRestore();
    });
  });

  describe('togglePlugin', () => {
    it('should add plugin id to plugins array if not present and open is true or undefined', async () => {
      const { result } = renderHook(() => useAgentStore());
      const pluginId = 'plugin-id';
      const updateAgentConfigMock = vi
        .spyOn(result.current, 'updateAgentConfig')
        .mockResolvedValue(undefined);
      // 模拟当前配置不包含插件 ID
      vi.spyOn(agentSelectors, 'currentAgentConfig').mockReturnValue({ plugins: [] } as any);

      await act(async () => {
        await result.current.togglePlugin(pluginId);
      });

      expect(updateAgentConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ plugins: [pluginId] }),
      );
      updateAgentConfigMock.mockRestore();
    });

    it('should remove plugin id from plugins array if present and open is false', async () => {
      const { result } = renderHook(() => useAgentStore());
      const pluginId = 'plugin-id';
      const updateAgentConfigMock = vi
        .spyOn(result.current, 'updateAgentConfig')
        .mockResolvedValue(undefined);
      // 模拟当前配置包含插件 ID
      vi.spyOn(agentSelectors, 'currentAgentConfig').mockReturnValue({
        plugins: [pluginId],
      } as any);

      await act(async () => {
        await result.current.togglePlugin(pluginId, false);
      });

      expect(updateAgentConfigMock).toHaveBeenCalledWith(expect.objectContaining({ plugins: [] }));
      updateAgentConfigMock.mockRestore();
    });

    it('should not modify plugins array if plugin id is not present and open is false', async () => {
      const { result } = renderHook(() => useAgentStore());
      const pluginId = 'plugin-id';
      const updateAgentConfigMock = vi
        .spyOn(result.current, 'updateAgentConfig')
        .mockResolvedValue(undefined);

      // 模拟当前配置不包含插件 ID
      vi.spyOn(agentSelectors, 'currentAgentConfig').mockReturnValue({ plugins: [] } as any);

      await act(async () => {
        await result.current.togglePlugin(pluginId, false);
      });

      expect(updateAgentConfigMock).toHaveBeenCalledWith(expect.objectContaining({ plugins: [] }));
      updateAgentConfigMock.mockRestore();
    });
  });

  describe('updateAgentConfig', () => {
    it('should update global config if current session is inbox session', async () => {
      const { result } = renderHook(() => useAgentStore());
      const config = { model: 'gpt-3.5-turbo' };
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);
      const refreshMock = vi.spyOn(result.current, 'internal_refreshAgentConfig');

      await act(async () => {
        await result.current.updateAgentConfig(config);
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        'inbox',
        config,
        expect.any(AbortSignal),
      );
      expect(refreshMock).toHaveBeenCalled();
      updateSessionConfigMock.mockRestore();
      refreshMock.mockRestore();
    });

    it('should update session config if current session is not inbox session', async () => {
      const { result } = renderHook(() => useAgentStore());
      const config = { model: 'gpt-3.5-turbo' };
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);
      const refreshMock = vi.spyOn(result.current, 'internal_refreshAgentConfig');

      // 模拟当前会话不是收件箱会话
      act(() => {
        useAgentStore.setState({
          activeId: 'session-id',
        });
      });

      await act(async () => {
        await result.current.updateAgentConfig(config);
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        'session-id',
        config,
        expect.any(AbortSignal),
      );
      expect(refreshMock).toHaveBeenCalled();
      updateSessionConfigMock.mockRestore();
      refreshMock.mockRestore();
    });

    it('should not update config if there is no current session', async () => {
      const { result } = renderHook(() => useAgentStore());
      const config = { model: 'gpt-3.5-turbo' };
      const updateSessionConfigMock = vi.spyOn(sessionService, 'updateSessionConfig');

      // 模拟没有当前会话
      act(() => {
        useAgentStore.setState({ activeId: null as any });
      });

      await act(async () => {
        await result.current.updateAgentConfig(config);
      });

      expect(updateSessionConfigMock).not.toHaveBeenCalled();
      updateSessionConfigMock.mockRestore();
    });
  });

  describe('useFetchAgentConfig', () => {
    it('should update agentConfig and isAgentConfigInit when data changes and isAgentConfigInit is false', async () => {
      const { result } = renderHook(() => useAgentStore());

      // act(() => {
      //   result.current.agentMap = {};
      // });

      vi.spyOn(sessionService, 'getSessionConfig').mockResolvedValueOnce({ model: 'gpt-4' } as any);

      renderHook(() => result.current.useFetchAgentConfig(true, 'test-session-id'));

      await waitFor(() => {
        expect(result.current.agentMap['test-session-id']).toEqual({ model: 'gpt-4' });
        // expect(result.current.isAgentConfigInit).toBe(true);
      });
    });

    it('should not update state when data is the same and isAgentConfigInit is true', async () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          agentMap: {
            'test-session-id': { model: 'gpt-3.5-turbo' },
          },
        });
      });

      vi.spyOn(useSessionStore, 'setState');
      vi.spyOn(sessionService, 'getSessionConfig').mockResolvedValueOnce({
        model: 'gpt-3.5-turbo',
      } as any);

      renderHook(() => result.current.useFetchAgentConfig(true, 'test-session-id'));

      await waitFor(() => {
        expect(result.current.agentMap['test-session-id']).toEqual({ model: 'gpt-3.5-turbo' });

        expect(useSessionStore.setState).not.toHaveBeenCalled();
      });
    });
  });

  describe('rollupAssistantMemory', () => {
    it('should save normalized capped assistant memory from topic summaries', async () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          activeId: 'session-1',
          agentMap: {
            'session-1': {
              assistantMemory: 'old memory',
            },
          },
        } as any);
      });

      const listTopicsMock = vi.mocked(topicService.listTopicsForAgentMemoryRollup);
      listTopicsMock.mockResolvedValue([
        {
          historySummary: 'User prefers concise answers.',
          id: 'topic-1',
          sessionId: 'session-1',
          title: 'Preferences',
          updatedAt: new Date(),
        },
      ]);

      const fetchPresetTaskResultMock = vi.mocked(chatService.fetchPresetTaskResult);
      fetchPresetTaskResultMock.mockImplementation(async ({ onFinish }) => {
        await onFinish?.(
          `\`\`\`markdown\nHere is the updated assistant memory:\n${'a'.repeat(
            ASSISTANT_MEMORY_MAX_CHARS + 500,
          )}\n\`\`\``,
        );
      });

      const updateMock = vi.spyOn(result.current, 'updateAgentConfig').mockResolvedValue(undefined);

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({ success: true });
      expect(listTopicsMock).toHaveBeenCalledWith(
        'agent-1',
        ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
      );

      const savedMemory = updateMock.mock.calls[0][0].assistantMemory as string;
      expect(savedMemory).not.toContain('```');
      expect(savedMemory).not.toMatch(/^Here is/i);
      expect(savedMemory.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);

      listTopicsMock.mockReset();
      fetchPresetTaskResultMock.mockReset();
      updateMock.mockRestore();
      act(() => {
        useAgentStore.setState({
          activeAgentId: undefined,
          activeId: INBOX_SESSION_ID,
          agentMap: {},
        } as any);
      });
    });
  });

  describe('useFetchInboxAgentConfig', () => {
    it('should merge DEFAULT_AGENT_CONFIG and update defaultAgentConfig and isDefaultAgentConfigInit on success', async () => {
      const { result } = renderHook(() => useAgentStore());
      vi.spyOn(sessionService, 'getSessionConfig').mockResolvedValue({
        model: 'gemini-pro',
      } as any);

      renderHook(() => result.current.useInitInboxAgentStore(true));

      await waitFor(async () => {
        expect(result.current.agentMap[INBOX_SESSION_ID]).toEqual({ model: 'gemini-pro' });
        expect(result.current.isInboxAgentConfigInit).toBe(true);
      });
    });

    it('should not modify state if user not logged in', async () => {
      const { result } = renderHook(() => useAgentStore());
      vi.spyOn(sessionService, 'getSessionConfig').mockResolvedValue({
        model: 'gemini-pro',
      } as any);

      renderHook(() => result.current.useInitInboxAgentStore(false));

      await waitFor(async () => {
        expect(result.current.agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(result.current.isInboxAgentConfigInit).toBe(false);
      });
    });

    it('should not modify state on failure', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.spyOn(globalService, 'getDefaultAgentConfig').mockRejectedValueOnce(new Error());

      renderHook(() => result.current.useInitInboxAgentStore(true));

      await waitFor(async () => {
        expect(result.current.agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(result.current.isInboxAgentConfigInit).toBe(false);
      });
    });
  });

  describe('updateAgentChatConfig', () => {
    it('preserves string reasoningEffort values', async () => {
      const { result } = renderHook(() => useAgentStore());
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAgentChatConfig({ reasoningEffort: 'high' });
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        INBOX_SESSION_ID,
        { chatConfig: { reasoningEffort: 'high' } },
        expect.any(AbortSignal),
      );
    });

    it('omits non-string reasoningEffort values from persisted chat config updates', async () => {
      const { result } = renderHook(() => useAgentStore());
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAgentChatConfig({
          enableReasoning: true,
          reasoningEffort: true,
        } as any);
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        INBOX_SESSION_ID,
        { chatConfig: { enableReasoning: true } },
        expect.any(AbortSignal),
      );
    });

    it('preserves unrelated chat config fields while sanitizing reasoningEffort', async () => {
      const { result } = renderHook(() => useAgentStore());
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateAgentChatConfig({
          enableHistoryCount: true,
          enableReasoning: true,
          gpt5ReasoningEffort: 'medium',
          minimaxReasoningSplit: true,
          reasoningEffort: false,
          searchMode: 'auto',
        } as any);
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        INBOX_SESSION_ID,
        {
          chatConfig: {
            enableHistoryCount: true,
            enableReasoning: true,
            gpt5ReasoningEffort: 'medium',
            minimaxReasoningSplit: true,
            searchMode: 'auto',
          },
        },
        expect.any(AbortSignal),
      );
    });
  });

  describe('internal_updateAgentConfig', () => {
    it('should call sessionService.updateSessionConfig', async () => {
      const { result } = renderHook(() => useAgentStore());

      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.internal_updateAgentConfig('test-session-id', { foo: 'bar' } as any);
      });

      expect(updateSessionConfigMock).toHaveBeenCalledWith(
        'test-session-id',
        { foo: 'bar' },
        undefined,
      );
    });

    it('should trigger internal_refreshAgentConfig', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.spyOn(sessionService, 'updateSessionConfig').mockResolvedValue(undefined);
      const refreshMock = vi.spyOn(result.current, 'internal_refreshAgentConfig');

      await act(async () => {
        await result.current.internal_updateAgentConfig('test-session-id', {});
      });

      expect(refreshMock).toHaveBeenCalledWith('test-session-id');
    });

    it('should trigger useSessionStore.refreshSessions when model changes', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.spyOn(sessionService, 'updateSessionConfig').mockResolvedValue(undefined);
      vi.spyOn(agentSelectors, 'currentAgentModel').mockReturnValueOnce('gpt-3.5-turbo');

      const refreshSessionsMock = vi.spyOn(useSessionStore.getState(), 'refreshSessions');

      await act(async () => {
        await result.current.internal_updateAgentConfig('test-session-id', { model: 'gpt-4' });
      });

      expect(refreshSessionsMock).toHaveBeenCalled();
    });
  });

  describe('internal_refreshAgentConfig', () => {
    it('should call mutate with correct key', async () => {
      const { result } = renderHook(() => useAgentStore());

      await act(async () => {
        await result.current.internal_refreshAgentConfig('test-session-id');
      });

      expect(mutate).toHaveBeenCalledWith(['FETCH_AGENT_CONFIG', 'test-session-id']);
    });
  });

  describe('edge cases', () => {
    it('should not update config if activeId is null', async () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({ activeId: null } as any);
      });

      const updateMock = vi.spyOn(result.current, 'internal_updateAgentConfig');

      await act(async () => {
        await result.current.updateAgentConfig({});
      });

      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});
