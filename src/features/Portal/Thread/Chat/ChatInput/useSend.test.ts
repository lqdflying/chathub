import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { useSendThreadMessage } from './useSend';

vi.mock('@/hooks/useGeminiChineseWarning', () => ({
  useGeminiChineseWarning: () => vi.fn(),
}));

describe('useSendThreadMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
