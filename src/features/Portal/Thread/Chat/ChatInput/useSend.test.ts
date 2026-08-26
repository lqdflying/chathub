import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_PASTED_TEXT_SCOPE, getThreadPastedTextScope } from '@/features/ChatInput/pastedText/scope';
import { selectPastedTextItems, usePastedTextStore } from '@/features/ChatInput/pastedText/store';
import { useChatStore } from '@/store/chat';

import { useSendThreadMessage } from './useSend';

const checkGeminiChineseWarning = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useGeminiChineseWarning', () => ({
  useGeminiChineseWarning: () => checkGeminiChineseWarning,
}));

describe('useSendThreadMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      chatLoadingIds: [],
      isCreatingThread: false,
      isCreatingThreadMessage: false,
      messageLoadingIds: [],
      messageRAGLoadingIds: [],
      threadInputEditor: undefined,
    });
    usePastedTextStore.getState().clearAllPastedTexts();
  });

  it('stops the portal thread rather than the workspace thread', () => {
    const stopGenerateMessage = vi.fn();
    useChatStore.setState({
      activeThreadId: 'workspace-thread',
      portalThreadId: 'portal-thread',
      stopGenerateMessage,
    });

    const { result } = renderHook(() => useSendThreadMessage());
    act(() => result.current.stop());

    expect(stopGenerateMessage).toHaveBeenCalledWith({ threadId: 'portal-thread' });
  });

  it('contains a rejected thread send after clearing the editor', async () => {
    const sendError = new Error('Knowledge Base preparation failed');
    const sendThreadMessage = vi.fn().mockRejectedValue(sendError);
    const clearContent = vi.fn();
    const focus = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    checkGeminiChineseWarning.mockResolvedValue(true);
    useChatStore.setState({
      sendThreadMessage,
      threadInputEditor: {
        clearContent,
        focus,
        getMarkdownContent: () => 'test with rag',
      } as any,
    });

    const { result } = renderHook(() => useSendThreadMessage());

    await act(async () => {
      await result.current.send();
    });

    expect(sendThreadMessage).toHaveBeenCalledWith({ message: 'test with rag' });
    expect(clearContent).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to send thread message', sendError);
    });
  });

  it('sends chips only when the thread editor is empty', async () => {
    const sendThreadMessage = vi.fn().mockResolvedValue(undefined);
    const clearContent = vi.fn();
    const focus = vi.fn();
    checkGeminiChineseWarning.mockResolvedValue(true);
    usePastedTextStore.getState().addPastedText(MAIN_PASTED_TEXT_SCOPE, 'main dump');
    usePastedTextStore
      .getState()
      .addPastedText(getThreadPastedTextScope('portal-thread'), 'thread dump');
    useChatStore.setState({
      portalThreadId: 'portal-thread',
      sendThreadMessage,
      threadInputEditor: {
        clearContent,
        focus,
        getMarkdownContent: () => '',
      } as any,
    });

    const { result } = renderHook(() => useSendThreadMessage());

    await act(async () => {
      await result.current.send();
    });

    expect(sendThreadMessage).toHaveBeenCalledWith({ message: 'thread dump' });
    expect(
      selectPastedTextItems(getThreadPastedTextScope('portal-thread'))(usePastedTextStore.getState()),
    ).toEqual([]);
    expect(
      selectPastedTextItems(MAIN_PASTED_TEXT_SCOPE)(usePastedTextStore.getState()).map(
        (item) => item.content,
      ),
    ).toEqual(['main dump']);
    expect(clearContent).toHaveBeenCalled();
  });
});
