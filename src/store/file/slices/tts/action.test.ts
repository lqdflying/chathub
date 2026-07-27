import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { useFileStore as useStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

//  mock the arrayBuffer
beforeAll(() => {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    writable: true,
    value: function () {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.readAsArrayBuffer(this);
      });
    },
  });

  createServerConfigStore();
});

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
  useUserStore.setState({
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'account-a' },
    userStateInitializationFailure: undefined,
  });
  useStore.setState({ scopeGeneration: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('TTSFileAction', () => {
  // Test for removeTTSFile
  it('removeTTSFile should call fileService.removeFile', async () => {
    const fileId = 'tts-file-id';

    // Mock the fileService.removeFile to resolve
    vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);

    await act(async () => {
      await useStore.getState().removeTTSFile(fileId);
    });

    expect(fileService.removeFile).toHaveBeenCalledWith(fileId);
  });

  // Test for uploadTTSByArrayBuffers
  it('uploadTTSByArrayBuffers should create a file and call uploadTTSFile', async () => {
    const messageId = 'message-id';
    const arrayBuffers = [new ArrayBuffer(10)];
    const fileType = 'audio/mp3';
    const fileName = `${messageId}.mp3`;

    // Spy on uploadTTSFile to simulate a successful upload
    const uploadTTSFileSpy = vi
      .spyOn(useStore.getState(), 'uploadWithProgress')
      .mockResolvedValue({ id: 'new-tts-file-id', url: '1' });

    let fileId;
    await act(async () => {
      fileId = await useStore.getState().uploadTTSByArrayBuffers(messageId, arrayBuffers);
    });

    expect(uploadTTSFileSpy).toHaveBeenCalled();
    expect(fileId).toBe('new-tts-file-id');

    // Cleanup spy
    uploadTTSFileSpy.mockRestore();
  });

  describe('account mutation ownership', () => {
    it('blocks TTS creation and removal during a same-scope owner mismatch', async () => {
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const uploadWithProgress = vi.spyOn(useStore.getState(), 'uploadWithProgress');

      let createdFileId: string | undefined;
      await act(async () => {
        await useStore.getState().removeTTSFile('blocked-tts-file');
        createdFileId = await useStore
          .getState()
          .uploadTTSByArrayBuffers('blocked-message', [new ArrayBuffer(10)]);
      });

      expect(removeFile).not.toHaveBeenCalled();
      expect(uploadWithProgress).not.toHaveBeenCalled();
      expect(createdFileId).toBeUndefined();
    });

    it('aborts TTS creation and suppresses its stale result after account invalidation', async () => {
      const uploadResult = createDeferred<{ id: string; url: string } | undefined>();
      let uploadSignal: AbortSignal | undefined;
      vi.spyOn(useStore.getState(), 'uploadWithProgress').mockImplementation(async ({ signal }) => {
        uploadSignal = signal;
        return uploadResult.promise;
      });

      const creationPromise = useStore
        .getState()
        .uploadTTSByArrayBuffers('account-a-message', [new ArrayBuffer(10)]);
      await waitFor(() => {
        expect(useStore.getState().uploadWithProgress).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState((state) => ({
          ownershipInvalidationGeneration: state.ownershipInvalidationGeneration + 1,
        }));
        uploadResult.resolve({ id: 'stale-tts-file', url: 'https://example.com/stale-tts' });
      });

      let createdFileId: string | undefined;
      await act(async () => {
        createdFileId = await creationPromise;
      });

      expect(uploadSignal?.aborted).toBe(true);
      expect(createdFileId).toBeUndefined();
    });

    it('allows explicit removal to settle without requiring active navigation identity', async () => {
      const removalFinished = createDeferred<void>();
      const removeFile = vi
        .spyOn(fileService, 'removeFile')
        .mockReturnValue(removalFinished.promise);

      const removalPromise = useStore.getState().removeTTSFile('target-tts-file');
      await waitFor(() => {
        expect(removeFile).toHaveBeenCalledWith('target-tts-file');
      });

      act(() => {
        useUserStore.setState((state) => ({
          ownershipInvalidationGeneration: state.ownershipInvalidationGeneration + 1,
        }));
        removalFinished.resolve();
      });

      await expect(removalPromise).resolves.toBeUndefined();
      expect(removeFile).toHaveBeenCalledTimes(1);
    });
  });

  // Test for useFetchTTSFile
  it('useFetchTTSFile should fetch and return file data', async () => {
    const fileId = 'tts-file-id';
    const fileData = {
      id: fileId,
      name: 'test',
      url: 'blob:test',
      fileType: 'audio/mp3',
      base64Url: '',
      saveMode: 'local',
    };

    // Mock the fileService.getFile to resolve with fileData
    vi.spyOn(fileService, 'getFile').mockResolvedValue(fileData as any);

    const { result } = renderHook(() => useStore.getState().useFetchTTSFile(fileId));

    // Wait for SWR to fetch data
    await waitFor(() => {
      expect(result.current.data).toEqual(fileData);
    });

    expect(fileService.getFile).toHaveBeenCalledWith(fileId);
  });
});
