import { act, renderHook } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { pythonService } from '@/services/python';
import { useChatStore } from '@/store/chat';

vi.mock('@/services/python', () => ({
  pythonService: {
    runPython: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainDisplayChats: vi.fn().mockReturnValue([]),
  },
}));

describe('code interpreter actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      codeInterpreterExecuting: {},
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
});
