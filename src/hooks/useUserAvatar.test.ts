import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useUserAvatar } from './useUserAvatar';

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lobechat/const')>();
  return {
    ...actual,
    DEFAULT_USER_AVATAR: 'default-avatar.png',
  };
});

describe('useUserAvatar', () => {
  it('should return default avatar when user has no avatar', () => {
    act(() => {
      useUserStore.setState({ user: { avatar: undefined } as any });
    });

    const { result } = renderHook(() => useUserAvatar());

    expect(result.current).toBe('default-avatar.png');
  });

  it('should return user avatar when available', () => {
    const mockAvatar = 'https://example.com/avatar.png';

    act(() => {
      useUserStore.setState({ user: { avatar: mockAvatar } as any });
    });

    const { result } = renderHook(() => useUserAvatar());

    expect(result.current).toBe(mockAvatar);
  });

  it('should preserve a relative server avatar URL', () => {
    const mockAvatar = '/api/avatar.png';

    act(() => {
      useUserStore.setState({ user: { avatar: mockAvatar } as any });
    });

    const { result } = renderHook(() => useUserAvatar());

    expect(result.current).toBe(mockAvatar);
  });
});
