import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';

const createDeferred = <Result>() => {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    codeInterpreter: {
      run: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('@/services/file', () => ({
  fileService: {
    getFile: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageById: vi.fn(() => () => ({
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    })),
    getMessageByToolCallId: vi.fn(() => () => undefined),
    mainDisplayChats: vi.fn().mockReturnValue([]),
  },
}));

describe('code interpreter actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      activeId: 'session-1',
      activeTopicId: 'topic-1',
      codeInterpreterExecuting: {},
      conversationClearGeneration: 0,
      internal_updateMessageContent: vi.fn(),
      updatePluginState: vi.fn(),
      uploadInterpreterFiles: vi.fn(),
    });
  });

  it('returns an explicit failed outcome without continuing after the sandbox rejects', async () => {
    const executionError = new Error('Python execution failed');
    (lambdaClient.codeInterpreter.run.mutate as Mock).mockRejectedValue(executionError);
    const { result } = renderHook(() => useChatStore());

    let executionResult;
    await act(async () => {
      executionResult = await result.current.python('tool-message', {
        code: 'raise RuntimeError()',
        packages: [],
      });
    });

    const serializedError = { message: 'Python execution failed', name: 'Error' };
    expect(executionResult).toEqual({
      data: serializedError,
      outcome: 'failed',
      shouldContinue: false,
    });
    expect(result.current.updatePluginState).toHaveBeenCalledWith('tool-message', {
      error: serializedError,
    });
    expect(result.current.codeInterpreterExecuting['tool-message']).toBe(false);
  });

  it('returns the sandbox response and continues after successful execution', async () => {
    const response = { output: [{ data: 'success', type: 'stdout' }], success: true };
    (lambdaClient.codeInterpreter.run.mutate as Mock).mockResolvedValue(response);
    const { result } = renderHook(() => useChatStore());

    let executionResult;
    await act(async () => {
      executionResult = await result.current.python('tool-message', {
        code: 'print("success")',
        packages: [],
      });
    });

    expect(lambdaClient.codeInterpreter.run.mutate).toHaveBeenCalledWith({
      code: 'print("success")',
      groupId: undefined,
      packages: [],
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });
    expect(executionResult).toEqual({
      data: response,
      outcome: 'completed',
      shouldContinue: true,
    });
    expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
      'tool-message',
      JSON.stringify(response),
    );
    expect(result.current.codeInterpreterExecuting['tool-message']).toBe(false);
    expect(result.current.uploadInterpreterFiles).not.toHaveBeenCalled();
  });

  it('drops a sandbox result that completes after conversation history is cleared', async () => {
    const deferredExecution = createDeferred<{ success: boolean }>();
    (lambdaClient.codeInterpreter.run.mutate as Mock).mockReturnValue(deferredExecution.promise);
    const { result } = renderHook(() => useChatStore());
    let executionPromise!: ReturnType<typeof result.current.python>;

    act(() => {
      executionPromise = result.current.python('tool-message', {
        code: 'print("stale")',
        packages: [],
      });
    });

    await vi.waitFor(() => {
      expect(lambdaClient.codeInterpreter.run.mutate).toHaveBeenCalledOnce();
    });

    act(() => {
      useChatStore.setState((state) => ({
        codeInterpreterExecuting: {},
        conversationClearGeneration: state.conversationClearGeneration + 1,
      }));
    });
    deferredExecution.resolve({ success: true });

    let executionResult;
    await act(async () => {
      executionResult = await executionPromise;
    });

    expect(executionResult).toEqual({
      data: undefined,
      outcome: 'cancelled',
      shouldContinue: false,
    });
    expect(result.current.internal_updateMessageContent).not.toHaveBeenCalled();
    expect(result.current.updatePluginState).not.toHaveBeenCalled();
    expect(result.current.uploadInterpreterFiles).not.toHaveBeenCalled();
    expect(result.current.codeInterpreterExecuting).toEqual({});
  });
});
