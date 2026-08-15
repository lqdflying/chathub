import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';
import { pythonService } from '@/services/python';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

const createDeferred = <Result>() => {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

vi.mock('@/services/python', () => ({
  pythonService: {
    runPython: vi.fn(),
  },
}));

vi.mock('@/services/file', () => ({
  fileService: {
    getFile: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageByToolCallId: vi.fn(() => () => undefined),
    mainDisplayChats: vi.fn().mockReturnValue([]),
  },
}));

describe('code interpreter actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      codeInterpreterExecuting: {},
      conversationClearGeneration: 0,
      internal_updateMessageContent: vi.fn(),
      updatePluginState: vi.fn(),
      uploadInterpreterFiles: vi.fn(),
    });
  });

  it('returns an explicit failed outcome without continuing after Python rejects', async () => {
    const executionError = new Error('Python execution failed');
    (pythonService.runPython as Mock).mockRejectedValue(executionError);
    const { result } = renderHook(() => useChatStore());

    let executionResult;
    await act(async () => {
      executionResult = await result.current.python('tool-message', {
        code: 'raise RuntimeError()',
      });
    });

    expect(executionResult).toEqual({
      data: executionError,
      outcome: 'failed',
      shouldContinue: false,
    });
    expect(result.current.updatePluginState).toHaveBeenCalledWith('tool-message', {
      error: executionError,
    });
    expect(result.current.codeInterpreterExecuting['tool-message']).toBe(false);
  });

  it('returns the Python response and continues after successful execution', async () => {
    const response = { stderr: '', stdout: 'success' };
    (pythonService.runPython as Mock).mockResolvedValue(response);
    const { result } = renderHook(() => useChatStore());

    let executionResult;
    await act(async () => {
      executionResult = await result.current.python('tool-message', {
        code: 'print("success")',
      });
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
  });

  it('loads later interpreter files even when an earlier file id is stale (finding D/7)', async () => {
    const priorContent = JSON.stringify({
      files: [
        { fileId: 'stale', filename: 'a.txt' },
        { fileId: 'good', filename: 'b.txt' },
      ],
    });
    (chatSelectors.mainDisplayChats as Mock).mockReturnValueOnce([
      { tools: [{ id: 'call-1', identifier: CodeInterpreterIdentifier }] },
    ]);
    (chatSelectors.getMessageByToolCallId as Mock).mockReturnValueOnce(() => ({
      content: priorContent,
    }));
    (fileService.getFile as Mock)
      .mockRejectedValueOnce(new Error('deleted'))
      .mockResolvedValueOnce({ url: 'https://files/b' });
    global.fetch = vi
      .fn()
      .mockResolvedValue({ blob: () => Promise.resolve(new Blob(['b'])), ok: true }) as any;
    (pythonService.runPython as Mock).mockResolvedValue({ stdout: 'ok' });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.python('tool-message', { code: 'print(1)' });
    });

    const filesArg = (pythonService.runPython as Mock).mock.calls[0][2] as File[];
    expect(filesArg.map((f) => f.name)).toEqual(['b.txt']);
  });

  it('skips a non-OK interpreter file fetch without dropping later inputs (finding D/7)', async () => {
    const priorContent = JSON.stringify({
      files: [
        { fileId: 'a', filename: 'a.txt' },
        { fileId: 'b', filename: 'b.txt' },
      ],
    });
    (chatSelectors.mainDisplayChats as Mock).mockReturnValueOnce([
      { tools: [{ id: 'call-1', identifier: CodeInterpreterIdentifier }] },
    ]);
    (chatSelectors.getMessageByToolCallId as Mock).mockReturnValueOnce(() => ({
      content: priorContent,
    }));
    (fileService.getFile as Mock)
      .mockResolvedValueOnce({ url: 'https://files/a' })
      .mockResolvedValueOnce({ url: 'https://files/b' });
    // first url 404s, second is ok
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ blob: () => Promise.resolve(new Blob(['b'])), ok: true }) as any;
    (pythonService.runPython as Mock).mockResolvedValue({ stdout: 'ok' });

    const { result } = renderHook(() => useChatStore());
    await act(async () => {
      await result.current.python('tool-message', { code: 'print(1)' });
    });

    const filesArg = (pythonService.runPython as Mock).mock.calls[0][2] as File[];
    expect(filesArg.map((f) => f.name)).toEqual(['b.txt']);
  });

  it('drops a Python result that completes after conversation history is cleared', async () => {
    const deferredExecution = createDeferred<{ stderr: string; stdout: string }>();
    (pythonService.runPython as Mock).mockReturnValue(deferredExecution.promise);
    const { result } = renderHook(() => useChatStore());
    let executionPromise!: ReturnType<typeof result.current.python>;

    act(() => {
      executionPromise = result.current.python('tool-message', {
        code: 'print("stale")',
      });
    });

    await vi.waitFor(() => {
      expect(pythonService.runPython).toHaveBeenCalledOnce();
    });

    act(() => {
      useChatStore.setState((state) => ({
        codeInterpreterExecuting: {},
        conversationClearGeneration: state.conversationClearGeneration + 1,
      }));
    });
    deferredExecution.resolve({ stderr: '', stdout: 'stale' });

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
