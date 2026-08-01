import {
  ASSISTANT_MEMORY_MAX_CHARS,
  ASSISTANT_MEMORY_NO_CHANGES_SENTINEL,
  ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS,
  ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
} from '@lobechat/prompts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mutate } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { hashText } from '@/helpers/assistantMemory';
import { agentService } from '@/services/agent';
import { chatService } from '@/services/chat';
import { globalService } from '@/services/global';
import { sessionService } from '@/services/session';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSessionStore } from '@/store/session';
import { createSessionListBaseKey } from '@/store/session/sessionListKey';
import { useUserStore } from '@/store/user';

const { mutateAccountSWRByPredicate } = vi.hoisted(() => ({
  mutateAccountSWRByPredicate: vi.fn(),
}));

vi.mock('zustand/traditional', async () => {
  return await vi.importActual('zustand/traditional');
});
vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/swr')>()),
  mutateAccountSWRByPredicate,
}));
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));
// vitest runs without server/pglite env flags, which reads as the deprecated edition
// and would short-circuit rollupAssistantMemory
vi.mock('@/const/version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/version')>()),
  isDeprecatedEdition: false,
}));
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
vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: vi.fn(async (text: string) => Math.ceil(text.length / 4)),
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

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useAgentStore.setState({
    activeAgentId: undefined,
    activeId: INBOX_SESSION_ID,
    agentConfigInitMap: {},
    agentMap: {},
    inboxAgentRequestScope: undefined,
    inboxAgentScope: undefined,
    isInboxAgentConfigInit: false,
    scopeGeneration: 0,
    updateAgentConfigSignal: undefined,
  } as any);
  useUserStore.setState({
    authUserId: 'user-id',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'user-id' },
    userStateScope: 'user:user-id',
    userStateInitializationFailure: undefined,
  });
});

describe('AgentSlice', () => {
  describe('module boundary', () => {
    it('loads chatService lazily to keep agent-store initialization acyclic', async () => {
      const source = await readFile(
        resolve(process.cwd(), 'src/store/agent/slices/chat/action.ts'),
        'utf8',
      );

      expect(source).not.toMatch(/^\s*import\s+.*from ['"]@\/services\/chat['"];?$/m);
      expect(source).toContain("await import('@/services/chat')");
    });
  });

  describe('addFilesToAgent', () => {
    it('passes the same originating checkpoint to config and knowledge refreshes', async () => {
      vi.spyOn(agentService, 'createAgentFiles').mockResolvedValue(undefined);
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        scopeGeneration: 4,
      });
      const { result } = renderHook(() => useAgentStore());
      const refreshAgentConfig = vi
        .spyOn(result.current, 'internal_refreshAgentConfig')
        .mockResolvedValue(undefined);
      const refreshAgentKnowledge = vi
        .spyOn(result.current, 'internal_refreshAgentKnowledge')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.addFilesToAgent(['file-a'], false);
      });

      const originatingCheckpoint = refreshAgentConfig.mock.calls[0][1];
      const isOriginatingMutationCurrent = refreshAgentConfig.mock.calls[0][2];
      expect(originatingCheckpoint).toEqual({
        accountSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'user:user-id',
        },
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        scopeGeneration: 4,
      });
      expect(refreshAgentKnowledge.mock.calls[0][1]).toBe(originatingCheckpoint);
      expect(refreshAgentKnowledge.mock.calls[0][2]).toBe(isOriginatingMutationCurrent);
      expect(isOriginatingMutationCurrent?.()).toBe(true);
    });

    it('does not refresh a newly active agent after stale persistence completes', async () => {
      const createAgentFilesDeferred = createDeferred<void>();
      vi.spyOn(agentService, 'createAgentFiles').mockReturnValue(createAgentFilesDeferred.promise);
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        scopeGeneration: 4,
      });
      const { result } = renderHook(() => useAgentStore());
      const refreshAgentConfig = vi
        .spyOn(result.current, 'internal_refreshAgentConfig')
        .mockResolvedValue(undefined);
      const refreshAgentKnowledge = vi
        .spyOn(result.current, 'internal_refreshAgentKnowledge')
        .mockResolvedValue(undefined);

      let addFilesPromise!: Promise<void>;
      act(() => {
        addFilesPromise = result.current.addFilesToAgent(['file-a'], false);
      });
      expect(agentService.createAgentFiles).toHaveBeenCalledWith('agent-a', ['file-a'], false);

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-b',
          activeId: 'session-b',
          scopeGeneration: 5,
        });
      });
      createAgentFilesDeferred.resolve(undefined);
      await act(async () => {
        await addFilesPromise;
      });

      expect(refreshAgentConfig).not.toHaveBeenCalled();
      expect(refreshAgentKnowledge).not.toHaveBeenCalled();
    });
  });

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

      expect(togglePluginMock).toHaveBeenCalledWith(pluginId, false, expect.any(Object));
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
        expect.any(Object),
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

      expect(updateAgentConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ plugins: [] }),
        expect.any(Object),
      );
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

      expect(updateAgentConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({ plugins: [] }),
        expect.any(Object),
      );
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

    it('releases the abort-controller slot when the request settles', async () => {
      const { result } = renderHook(() => useAgentStore());
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockResolvedValue(undefined);

      let firstSignal: AbortSignal | undefined;
      updateSessionConfigMock.mockImplementation(async (_id, _data, signal) => {
        firstSignal ??= signal;
      });

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'a' });
      });

      // slot cleared on settle, so nothing can abort the completed request later
      expect(useAgentStore.getState().updateAgentConfigSignal).toBeUndefined();

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'b' });
      });

      expect(firstSignal?.aborted).toBe(false);
      expect(useAgentStore.getState().updateAgentConfigSignal).toBeUndefined();

      updateSessionConfigMock.mockRestore();
    });

    it('still aborts a previous IN-FLIGHT request when a new write starts', async () => {
      const release = createDeferred<void>();
      const { result } = renderHook(() => useAgentStore());
      const signals: AbortSignal[] = [];
      const updateSessionConfigMock = vi
        .spyOn(sessionService, 'updateSessionConfig')
        .mockImplementation(async (_id, _data, signal) => {
          signals.push(signal!);
          if (signals.length === 1) await release.promise;
        });

      let first!: Promise<void>;
      act(() => {
        first = result.current.updateAgentConfig({ model: 'a' });
      });
      await waitFor(() => expect(signals).toHaveLength(1));

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'b' });
      });

      expect(signals[0].aborted).toBe(true);
      release.resolve();
      await act(async () => {
        await first;
      });

      updateSessionConfigMock.mockRestore();
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

    it('does not persist or optimistically update during a same-scope owner mismatch', async () => {
      const originalConfig = { model: 'current-model' };
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        agentMap: { 'session-a': originalConfig },
      } as any);
      useUserStore.setState({
        ownershipInvalidationGeneration: 1,
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:user-id',
        },
      });
      const updateSessionConfig = vi.spyOn(sessionService, 'updateSessionConfig');
      const { result } = renderHook(() => useAgentStore());

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'blocked-model' });
      });

      expect(updateSessionConfig).not.toHaveBeenCalled();
      expect(useAgentStore.getState().agentMap['session-a']).toEqual(originalConfig);
      expect(useAgentStore.getState().updateAgentConfigSignal).toBeUndefined();
    });

    it('does not refresh or overwrite local config after pending ownership invalidation', async () => {
      const persistedUpdate = createDeferred<void>();
      vi.spyOn(sessionService, 'updateSessionConfig').mockReturnValue(persistedUpdate.promise);
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        agentMap: { 'session-a': { model: 'original-model' } },
      } as any);
      const { result } = renderHook(() => useAgentStore());
      const refreshAgentConfig = vi
        .spyOn(result.current, 'internal_refreshAgentConfig')
        .mockResolvedValue(undefined);
      let updatePromise!: Promise<void>;
      act(() => {
        updatePromise = result.current.updateAgentConfig({ model: 'pending-model' });
      });
      expect(useAgentStore.getState().agentMap['session-a']).toEqual({
        model: 'pending-model',
      });

      const quarantinedConfig = { model: 'quarantined-current-model' };
      act(() => {
        useUserStore.setState({
          ownershipInvalidationGeneration: 1,
          userStateInitializationFailure: {
            reason: 'owner-mismatch',
            scope: 'user:user-id',
          },
        });
        useAgentStore.setState({
          agentMap: { 'session-a': quarantinedConfig },
        } as any);
      });
      persistedUpdate.resolve();
      await act(async () => {
        await updatePromise;
      });

      expect(refreshAgentConfig).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
      expect(useAgentStore.getState().agentMap['session-a']).toEqual(quarantinedConfig);
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
    const seedAgent = (config: Record<string, any> = {}) => {
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          activeId: 'session-1',
          agentMap: {
            'session-1': {
              assistantMemory: 'old memory',
              ...config,
            },
          },
        } as any);
      });
    };

    const seedTopics = () => {
      vi.mocked(topicService.listTopicsForAgentMemoryRollup).mockResolvedValue([
        {
          historySummary: 'User prefers concise answers.',
          id: 'topic-1',
          sessionId: 'session-1',
          title: 'Preferences',
          updatedAt: new Date(),
        },
      ]);
    };

    const resetAgentState = () => {
      act(() => {
        useAgentStore.setState({
          activeAgentId: undefined,
          activeId: INBOX_SESSION_ID,
          agentMap: {},
        } as any);
      });
    };

    it('should save normalized capped assistant memory with watermarks and undo backup', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent();
      seedTopics();

      const fetchPresetTaskResultMock = vi.mocked(chatService.fetchPresetTaskResult);
      fetchPresetTaskResultMock.mockImplementation(async ({ onFinish }) => {
        await onFinish?.(
          `\`\`\`markdown\nHere is the updated assistant memory:\n${'a'.repeat(
            ASSISTANT_MEMORY_MAX_CHARS + 500,
          )}\n\`\`\``,
        );
      });

      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({ horizonTruncated: false, status: 'success' });
      expect(topicService.listTopicsForAgentMemoryRollup).toHaveBeenCalledWith(
        'agent-1',
        ASSISTANT_MEMORY_ROLLUP_MAX_TOPICS,
      );

      // request carries an output cap
      const params = fetchPresetTaskResultMock.mock.calls[0][0].params as any;
      expect(params.max_tokens).toBe(ASSISTANT_MEMORY_ROLLUP_MAX_OUTPUT_TOKENS);

      expect(updateMock).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ assistantMemory: expect.any(String) }),
        undefined,
        expect.any(Object),
        expect.any(Function),
      );
      const patch = updateMock.mock.calls[0][1] as any;
      const savedMemory = patch.assistantMemory as string;
      expect(savedMemory).not.toContain('```');
      expect(savedMemory).not.toMatch(/^Here is/i);
      expect(savedMemory.length).toBeLessThanOrEqual(ASSISTANT_MEMORY_MAX_CHARS);

      // full meta object: cleared error, fresh watermarks, prior kept as undo backup
      expect(patch.assistantMemoryMeta).toEqual({
        lastError: null,
        lastRollupAt: expect.any(String),
        previousMemory: { at: expect.any(String), text: 'old memory' },
        topicWatermarks: [
          {
            summaryHash: hashText('User prefers concise answers.'),
            topicId: 'topic-1',
            updatedAt: expect.any(Number),
          },
        ],
      });

      // sibling sessions of this agent get revalidated (A6)
      expect(mutateAccountSWRByPredicate).toHaveBeenCalledWith(
        'user:user-id',
        expect.any(Function),
      );
      const predicate = vi.mocked(mutateAccountSWRByPredicate).mock.calls.at(-1)![1] as (
        key: unknown,
      ) => boolean;
      expect(predicate(['FETCH_AGENT_CONFIG', 'user:user-id', 'sibling-session'])).toBe(true);
      expect(predicate(['FETCH_AGENT_KNOWLEDGE', 'user:user-id', 'agent-1'])).toBe(false);
      expect(predicate(['FETCH_AGENT_CONFIG', 'user:other', 'sibling-session'])).toBe(false);

      updateMock.mockRestore();
      resetAgentState();
    });

    it('joins concurrent calls into a single in-flight rollup', async () => {
      const llmStarted = createDeferred<void>();
      const llmRelease = createDeferred<void>();
      const { result } = renderHook(() => useAgentStore());
      seedAgent();
      seedTopics();

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
        llmStarted.resolve();
        await llmRelease.promise;
        await onFinish?.('merged memory');
      });
      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const first = result.current.rollupAssistantMemory();
      await llmStarted.promise;
      const second = result.current.rollupAssistantMemory();
      llmRelease.resolve();

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.status).toBe('success');
      expect(secondResult).toBe(firstResult);
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledTimes(1);

      updateMock.mockRestore();
      resetAgentState();
    });

    it('skips without an LLM call when no topic summary changed since the watermarks', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent({
        assistantMemoryMeta: {
          topicWatermarks: [
            {
              summaryHash: hashText('User prefers concise answers.'),
              topicId: 'topic-1',
              updatedAt: 1,
            },
          ],
        },
      });
      seedTopics();

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({
        horizonTruncated: false,
        reason: 'no_changes',
        status: 'skipped',
      });
      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();

      resetAgentState();
    });

    it('force rebuild ignores clean watermarks and reprocesses every topic', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent({
        assistantMemoryMeta: {
          topicWatermarks: [
            {
              summaryHash: hashText('User prefers concise answers.'),
              topicId: 'topic-1',
              updatedAt: 1,
            },
          ],
        },
      });
      seedTopics();

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
        await onFinish?.('rebuilt memory');
      });
      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const response = await result.current.rollupAssistantMemory({ force: true });

      expect(response.status).toBe('success');
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalledTimes(1);

      updateMock.mockRestore();
      resetAgentState();
    });

    it('advances watermarks without touching the doc on the NO_CHANGES sentinel', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent({
        assistantMemoryMeta: {
          previousMemory: { at: 'earlier', text: 'older backup' },
        },
      });
      seedTopics();

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
        await onFinish?.(ASSISTANT_MEMORY_NO_CHANGES_SENTINEL);
      });
      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({
        horizonTruncated: false,
        reason: 'no_changes',
        status: 'skipped',
      });
      const patch = updateMock.mock.calls[0][1] as any;
      expect(patch.assistantMemory).toBeUndefined();
      expect(patch.assistantMemoryMeta.previousMemory).toBeUndefined();
      expect(patch.assistantMemoryMeta.lastError).toBeNull();
      expect(patch.assistantMemoryMeta.topicWatermarks).toHaveLength(1);

      updateMock.mockRestore();
      resetAgentState();
    });

    it('records lastError with incremented attempts and preserves memory on failure', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent({
        assistantMemoryMeta: {
          lastError: { at: '2000-01-01T00:00:00.000Z', attempts: 2, message: 'earlier' },
        },
      });
      seedTopics();

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onError }) => {
        onError?.(new Error('provider exploded'), undefined);
      });
      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({ reason: 'provider exploded', status: 'failed' });
      const patch = updateMock.mock.calls[0][1] as any;
      expect(patch.assistantMemory).toBeUndefined();
      expect(patch.assistantMemoryMeta.lastError).toEqual({
        at: expect.any(String),
        attempts: 3,
        message: 'provider exploded',
      });

      updateMock.mockRestore();
      resetAgentState();
    });

    it('honors the failure backoff for scheduled runs but not manual ones', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent({
        assistantMemoryMeta: {
          lastError: { at: new Date().toISOString(), attempts: 1, message: 'boom' },
        },
      });
      seedTopics();

      const scheduled = await result.current.rollupAssistantMemory({ trigger: 'scheduled' });
      expect(scheduled).toEqual({ reason: 'backoff', status: 'skipped' });
      expect(topicService.listTopicsForAgentMemoryRollup).not.toHaveBeenCalled();

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
        await onFinish?.('manual retry output');
      });
      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      const manual = await result.current.rollupAssistantMemory({ trigger: 'manual' });
      expect(manual.status).toBe('success');

      updateMock.mockRestore();
      resetAgentState();
    });

    it('returns skipped when there is no compacted topic summary', async () => {
      const { result } = renderHook(() => useAgentStore());
      seedAgent();
      vi.mocked(topicService.listTopicsForAgentMemoryRollup).mockResolvedValue([
        { historySummary: '  ', id: 'topic-1', sessionId: 's', title: 't', updatedAt: new Date() },
      ]);

      const response = await result.current.rollupAssistantMemory();

      expect(response).toEqual({ reason: 'no_summaries', status: 'skipped' });
      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();

      resetAgentState();
    });

    it('does not write memory after an A-to-B-to-A account reset', async () => {
      const rollupFinished = createDeferred<void>();
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'account-a-agent',
          activeId: 'account-a-session',
          agentMap: {
            'account-a-session': {
              assistantMemory: 'account A memory',
            },
          },
          scopeGeneration: 0,
        } as any);
        useUserStore.setState({
          authUserId: 'account-a',
          user: { id: 'account-a' },
          userStateScope: 'user:account-a',
        });
      });

      vi.mocked(topicService.listTopicsForAgentMemoryRollup).mockResolvedValue([
        {
          historySummary: 'Account A prefers concise answers.',
          id: 'account-a-topic',
          sessionId: 'account-a-session',
          title: 'Account A preferences',
          updatedAt: new Date(),
        },
      ]);
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation(async ({ onFinish }) => {
        await rollupFinished.promise;
        await onFinish?.('Rolled up account A memory.');
      });
      const updateSessionConfig = vi.spyOn(sessionService, 'updateSessionConfig');

      let rollupPromise!: ReturnType<typeof result.current.rollupAssistantMemory>;
      act(() => {
        rollupPromise = result.current.rollupAssistantMemory();
      });

      await waitFor(() => {
        expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          user: { id: 'account-b' },
          userStateScope: 'user:account-b',
        });
        useAgentStore.setState({
          activeAgentId: 'account-b-agent',
          activeId: 'account-b-session',
          agentMap: {
            'account-b-session': {
              assistantMemory: 'account B memory',
            },
          },
          scopeGeneration: 1,
        } as any);
        useUserStore.setState({
          authUserId: 'account-a',
          user: { id: 'account-a' },
          userStateScope: 'user:account-a',
        });
        useAgentStore.setState({
          activeAgentId: 'account-a-returned-agent',
          activeId: 'account-a-returned-session',
        } as any);
      });
      rollupFinished.resolve();

      let response!: Awaited<typeof rollupPromise>;
      await act(async () => {
        response = await rollupPromise;
      });

      expect(response).toEqual({ reason: 'stale_context', status: 'failed' });
      expect(updateSessionConfig).not.toHaveBeenCalled();
      expect(useAgentStore.getState().agentMap['account-a-returned-session']).toBeUndefined();
    });
  });

  describe('restoreAssistantMemoryBackup', () => {
    it('swaps current memory with the backup so restoring twice is a redo', async () => {
      const { result } = renderHook(() => useAgentStore());
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          activeId: 'session-1',
          agentMap: {
            'session-1': {
              assistantMemory: 'current memory',
              assistantMemoryMeta: {
                previousMemory: { at: 'earlier', text: 'previous memory' },
              },
            },
          },
        } as any);
      });

      const updateMock = vi
        .spyOn(result.current, 'internal_updateAgentConfig')
        .mockResolvedValue(undefined);

      await expect(result.current.restoreAssistantMemoryBackup()).resolves.toBe(true);

      expect(updateMock).toHaveBeenCalledWith(
        'session-1',
        {
          assistantMemory: 'previous memory',
          assistantMemoryMeta: {
            previousMemory: { at: expect.any(String), text: 'current memory' },
          },
        },
        undefined,
        expect.any(Object),
        expect.any(Function),
      );

      updateMock.mockRestore();
      act(() => {
        useAgentStore.setState({
          activeAgentId: undefined,
          activeId: INBOX_SESSION_ID,
          agentMap: {},
        } as any);
      });
    });

    it('returns false when there is no backup', async () => {
      const { result } = renderHook(() => useAgentStore());
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          activeId: 'session-1',
          agentMap: { 'session-1': { assistantMemory: 'current memory' } },
        } as any);
      });

      await expect(result.current.restoreAssistantMemoryBackup()).resolves.toBe(false);

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

      renderHook(() => result.current.useInitInboxAgentStore(true, 'user:user-id'));

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

      renderHook(() => result.current.useInitInboxAgentStore(false, undefined));

      await waitFor(async () => {
        expect(result.current.agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(result.current.isInboxAgentConfigInit).toBe(false);
      });
    });

    it('should not modify state on failure', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.spyOn(globalService, 'getDefaultAgentConfig').mockRejectedValueOnce(new Error());

      renderHook(() => result.current.useInitInboxAgentStore(true, 'user:user-id'));

      await waitFor(async () => {
        expect(result.current.agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(result.current.isInboxAgentConfigInit).toBe(false);
      });
    });

    it('keys inbox config by account and clears the previous account during a switch', async () => {
      const { result } = renderHook(() => useAgentStore());
      vi.spyOn(sessionService, 'getSessionConfig').mockResolvedValue({
        model: 'account-model',
      } as any);
      act(() => {
        useUserStore.setState({
          authUserId: 'account-a',
          isLoaded: true,
          user: { id: 'account-a' },
        });
      });
      const { rerender } = renderHook(
        ({ scope }) => result.current.useInitInboxAgentStore(true, scope),
        { initialProps: { scope: 'user:account-a' } },
      );

      await waitFor(() => {
        expect(useAgentStore.getState().inboxAgentScope).toBe('user:account-a');
        expect(useAgentStore.getState().agentMap[INBOX_SESSION_ID]).toEqual({
          model: 'account-model',
        });
      });

      act(() => {
        useUserStore.setState({ authUserId: undefined, isLoaded: false, user: undefined });
      });
      rerender({ scope: undefined });

      await waitFor(() => {
        expect(useAgentStore.getState().inboxAgentRequestScope).toBeUndefined();
        expect(useAgentStore.getState().agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(useAgentStore.getState().isInboxAgentConfigInit).toBe(false);
      });

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          isLoaded: true,
          user: { id: 'account-b' },
        });
      });
      rerender({ scope: 'user:account-b' });

      await waitFor(() => {
        expect(useAgentStore.getState().inboxAgentRequestScope).toBe('user:account-b');
        expect(useAgentStore.getState().agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(useAgentStore.getState().isInboxAgentConfigInit).toBe(false);
      });
    });

    it('ignores an inbox response after the authenticated identity changes', async () => {
      let resolveAccountA!: (config: any) => void;
      const accountAResponse = new Promise<any>((resolve) => {
        resolveAccountA = resolve;
      });
      vi.spyOn(sessionService, 'getSessionConfig').mockReturnValue(accountAResponse);
      act(() => {
        useUserStore.setState({
          authUserId: 'account-a',
          isLoaded: true,
          user: { id: 'account-a' },
        });
      });

      renderHook(() => useAgentStore.getState().useInitInboxAgentStore(true, 'user:account-a'));

      act(() => {
        useUserStore.setState({
          authUserId: 'account-b',
          isLoaded: true,
          user: { id: 'account-b' },
        });
        resolveAccountA({ model: 'account-a-model' });
      });

      await waitFor(() => {
        expect(useAgentStore.getState().agentMap[INBOX_SESSION_ID]).toBeUndefined();
        expect(useAgentStore.getState().inboxAgentScope).toBeUndefined();
        expect(useAgentStore.getState().isInboxAgentConfigInit).toBe(false);
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

      expect(refreshMock).toHaveBeenCalledWith(
        'test-session-id',
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('refreshes its explicit target after unrelated active navigation changes', async () => {
      const persistedUpdate = createDeferred<void>();
      vi.spyOn(sessionService, 'updateSessionConfig').mockReturnValue(persistedUpdate.promise);
      useAgentStore.setState({
        activeAgentId: 'agent-a',
        activeId: 'session-a',
        agentMap: { 'target-session': { model: 'original-model' } },
        scopeGeneration: 4,
      } as any);
      const { result } = renderHook(() => useAgentStore());
      const refreshAgentConfig = vi
        .spyOn(result.current, 'internal_refreshAgentConfig')
        .mockResolvedValue(undefined);

      let updatePromise!: Promise<void>;
      act(() => {
        updatePromise = result.current.internal_updateAgentConfig('target-session', {
          temperature: 0.4,
        });
      });
      expect(sessionService.updateSessionConfig).toHaveBeenCalledWith(
        'target-session',
        { temperature: 0.4 },
        undefined,
      );

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-b',
          activeId: 'session-b',
        });
      });
      persistedUpdate.resolve();
      await act(async () => {
        await updatePromise;
      });

      expect(refreshAgentConfig).toHaveBeenCalledWith(
        'target-session',
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('refreshes the epoch-aware session list with the originating account checkpoint', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.spyOn(sessionService, 'updateSessionConfig').mockResolvedValue(undefined);
      vi.spyOn(agentSelectors, 'currentAgentModel').mockReturnValueOnce('gpt-3.5-turbo');

      await act(async () => {
        await result.current.internal_updateAgentConfig('test-session-id', { model: 'gpt-4' });
      });

      expect(mutateAccountSWRByPredicate).toHaveBeenCalledTimes(1);
      const [requestedScope, predicate] = vi.mocked(mutateAccountSWRByPredicate).mock.calls[0];
      expect(requestedScope).toBe('user:user-id');
      expect(
        predicate([...createSessionListBaseKey('user:user-id', 0, 6), ['account-cache-epoch', 0]]),
      ).toBe(true);
      expect(
        predicate([
          ...createSessionListBaseKey('user:another-user', 0, 6),
          ['account-cache-epoch', 0],
        ]),
      ).toBe(false);
      expect(predicate(['FETCH_AGENT_CONFIG', 'user:user-id', 'test-session-id'])).toBe(false);
    });
  });

  describe('internal_refreshAgentConfig', () => {
    it('should call mutate with correct key', async () => {
      const { result } = renderHook(() => useAgentStore());

      await act(async () => {
        await result.current.internal_refreshAgentConfig('test-session-id');
      });

      expect(mutate).toHaveBeenCalledWith([
        'FETCH_AGENT_CONFIG',
        'user:user-id',
        'test-session-id',
        ['account-cache-epoch', 0],
      ]);
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
