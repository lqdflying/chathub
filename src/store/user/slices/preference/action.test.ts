import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSWR } from '~test-utils';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { userService } from '@/services/user';
import { useUserStore } from '@/store/user';
import { UserGuide, UserPreference } from '@/types/user';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(userService, 'migrateImageConfig').mockResolvedValue({
    imageConfig: {},
    migrated: true,
  });
  vi.spyOn(userService, 'updateImageConfig').mockResolvedValue(undefined);
  vi.spyOn(userService, 'updatePreference').mockResolvedValue(undefined);
  useUserStore.setState({ preference: DEFAULT_PREFERENCE, user: { id: 'user-id' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPreferenceSlice', () => {
  describe('updateGuideState', () => {
    it('should update guide state', () => {
      const { result } = renderHook(() => useUserStore());
      const guide: UserGuide = { topic: true };

      act(() => {
        result.current.updateGuideState(guide);
      });

      expect(result.current.preference.guide!.topic).toBeTruthy();
    });
  });

  describe('updatePreference', () => {
    it('should update preference without replaying the full hydrated snapshot', async () => {
      const { result } = renderHook(() => useUserStore());
      act(() => {
        useUserStore.setState({
          preference: {
            ...DEFAULT_PREFERENCE,
            imageConfig: { model: 'size-model', provider: 'custom-provider' },
          },
        });
      });

      await act(async () => {
        await result.current.updatePreference({ hideSyncAlert: true });
      });

      expect(result.current.preference.hideSyncAlert).toEqual(true);
      expect(result.current.preference.imageConfig).toEqual({
        model: 'size-model',
        provider: 'custom-provider',
      });
      expect(userService.updatePreference).toHaveBeenCalledWith(
        { hideSyncAlert: true },
        expect.any(AbortSignal),
      );
    });
  });

  describe('updateImageConfigState', () => {
    it('hydrates the database winner when legacy migration loses a race', async () => {
      vi.mocked(userService.migrateImageConfig).mockResolvedValueOnce({
        imageConfig: {
          imageNum: 8,
          model: 'newer-model',
          provider: 'newer-provider',
          size: '1536x1024',
        },
        migrated: false,
      });
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.migrateImageConfigState({
          imageNum: 4,
          model: 'legacy-model',
          provider: 'legacy-provider',
        });
      });

      expect(result.current.preference.imageConfig).toEqual({
        imageNum: 8,
        model: 'newer-model',
        provider: 'newer-provider',
        size: '1536x1024',
      });
      expect(userService.migrateImageConfig).toHaveBeenCalledWith(
        {
          imageNum: 4,
          model: 'legacy-model',
          provider: 'legacy-provider',
        },
        expect.any(AbortSignal),
      );
    });

    it('updates hydrated state optimistically and serializes persistence calls', async () => {
      const firstWrite = createDeferred();
      vi.mocked(userService.updateImageConfig)
        .mockReturnValueOnce(firstWrite.promise)
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useUserStore());

      let firstUpdate!: Promise<void>;
      let secondUpdate!: Promise<void>;
      act(() => {
        firstUpdate = result.current.updateImageConfigState({
          model: 'size-model',
          provider: 'custom-provider',
        });
        secondUpdate = result.current.updateImageConfigState({ imageNum: 8 });
      });

      expect(result.current.preference.imageConfig).toEqual({
        imageNum: 8,
        model: 'size-model',
        provider: 'custom-provider',
      });
      await waitFor(() => expect(userService.updateImageConfig).toHaveBeenCalledTimes(1));

      firstWrite.resolve();
      await waitFor(() => expect(userService.updateImageConfig).toHaveBeenCalledTimes(2));
      expect(userService.updateImageConfig).toHaveBeenLastCalledWith(
        {
          imageNum: 8,
          model: 'size-model',
          provider: 'custom-provider',
        },
        expect.any(AbortSignal),
      );
      await Promise.all([firstUpdate, secondUpdate]);
    });

    it('continues the write queue after a failed persistence request', async () => {
      vi.mocked(userService.updateImageConfig)
        .mockRejectedValueOnce(new Error('sync failed'))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useUserStore());

      let firstUpdate!: Promise<void>;
      let secondUpdate!: Promise<void>;
      act(() => {
        firstUpdate = result.current.updateImageConfigState({ imageNum: 4 });
        secondUpdate = result.current.updateImageConfigState({ imageNum: 8 });
      });

      await expect(firstUpdate).rejects.toThrow('sync failed');
      await expect(secondUpdate).resolves.toBeUndefined();
      expect(userService.updateImageConfig).toHaveBeenLastCalledWith(
        { imageNum: 8 },
        expect.any(AbortSignal),
      );
    });

    it('skips a queued persistence request after the active user changes', async () => {
      const firstWrite = createDeferred();
      vi.mocked(userService.updateImageConfig)
        .mockReturnValueOnce(firstWrite.promise)
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useUserStore());

      let firstUpdate!: Promise<void>;
      let secondUpdate!: Promise<void>;
      act(() => {
        firstUpdate = result.current.updateImageConfigState({ imageNum: 4 });
        secondUpdate = result.current.updateImageConfigState({ imageNum: 8 });
      });
      await waitFor(() => expect(userService.updateImageConfig).toHaveBeenCalledTimes(1));

      act(() => {
        useUserStore.setState({ user: { id: 'other-user' } });
      });
      firstWrite.resolve();

      await Promise.all([firstUpdate, secondUpdate]);
      expect(userService.updateImageConfig).toHaveBeenCalledTimes(1);
    });
  });
});
