import { act, renderHook, waitFor } from '@testing-library/react';
import { setChunkableFileCapabilities } from '@lobechat/utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { notification } from '@/components/AntdStaticMethods';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { uploadService } from '@/services/upload';
import { useUserStore } from '@/store/user';

import { useFileStore as useStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());
vi.mock('@/const/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/const/auth')>()),
  enableAuth: true,
}));

// Mock necessary modules and functions
vi.mock('@/components/AntdStaticMethods', () => ({
  notification: {
    error: vi.fn(),
  },
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
});

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
  setChunkableFileCapabilities({ markitdown: false });
  useUserStore.setState({
    authUserId: 'account-a',
    isLoaded: true,
    isSignedIn: true,
    isUserStateInit: true,
    ownershipInvalidationGeneration: 0,
    user: { id: 'account-a' },
    userStateScope: 'user:account-a',
    userStateInitializationFailure: undefined,
  });
  useStore.setState({
    chatUploadFileList: [],
    scopeGeneration: 0,
  });
});

afterEach(() => {
  setChunkableFileCapabilities({ markitdown: false });
  vi.restoreAllMocks();
});

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

describe('useFileStore:chat', () => {
  it('clearChatUploadFileList should clear the inputFilesList', () => {
    const { result } = renderHook(() => useStore());

    // Populate the list to clear it later
    act(() => {
      useStore.setState({ chatUploadFileList: [{ id: 'abc' }] as any });
    });

    expect(result.current.chatUploadFileList).toEqual([{ id: 'abc' }]);

    act(() => {
      result.current.clearChatUploadFileList();
    });

    expect(result.current.chatUploadFileList).toEqual([]);
  });

  describe('account mutation ownership', () => {
    it('blocks upload and removal during a same-scope owner mismatch', async () => {
      const existingFiles = [{ id: 'account-a-file', status: 'success' }] as any;
      useStore.setState({ chatUploadFileList: existingFiles });
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'user:account-a',
        },
      });
      const removeFile = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const uploadWithProgress = vi.spyOn(useStore.getState(), 'uploadWithProgress');
      const file = new File(['content'], 'blocked.txt', { type: 'text/plain' });

      await act(async () => {
        await useStore.getState().removeChatUploadFile('account-a-file');
        await useStore.getState().uploadChatFiles([file]);
      });

      expect(removeFile).not.toHaveBeenCalled();
      expect(uploadWithProgress).not.toHaveBeenCalled();
      expect(notification.error).not.toHaveBeenCalled();
      expect(useStore.getState().chatUploadFileList).toBe(existingFiles);
    });

    it('suppresses upload callbacks and RAG continuation after account invalidation', async () => {
      const uploadResult = createDeferred<{ id: string; url: string } | undefined>();
      let uploadSignal: AbortSignal | undefined;
      let statusUpdate: ((payload: any) => void) | undefined;
      vi.spyOn(useStore.getState(), 'uploadWithProgress').mockImplementation(
        async ({ onStatusUpdate, signal }) => {
          statusUpdate = onStatusUpdate;
          uploadSignal = signal;
          return uploadResult.promise;
        },
      );
      const parseFileContent = vi.spyOn(ragService, 'parseFileContent').mockResolvedValue(undefined);
      const file = new File(['content'], 'account-a.txt', { type: 'text/plain' });

      const uploadPromise = useStore.getState().uploadChatFiles([file]);
      await waitFor(() => {
        expect(useStore.getState().uploadWithProgress).toHaveBeenCalled();
      });

      const currentAccountFiles = [{ id: 'current-account-file', status: 'success' }] as any;
      act(() => {
        useUserStore.setState((state) => ({
          ownershipInvalidationGeneration: state.ownershipInvalidationGeneration + 1,
        }));
        useStore.setState({ chatUploadFileList: currentAccountFiles });
        statusUpdate?.({
          id: file.name,
          type: 'updateFile',
          value: { status: 'uploading' },
        });
        uploadResult.resolve({ id: 'stale-file-id', url: 'https://example.com/stale-file' });
      });
      await act(async () => {
        await uploadPromise;
      });

      expect(uploadSignal?.aborted).toBe(true);
      expect(parseFileContent).not.toHaveBeenCalled();
      expect(notification.error).not.toHaveBeenCalled();
      expect(useStore.getState().chatUploadFileList).toBe(currentAccountFiles);
    });

    it('does not touch the current file list when removal settles after invalidation', async () => {
      const removalFinished = createDeferred<void>();
      vi.spyOn(fileService, 'removeFile').mockReturnValue(removalFinished.promise);
      useStore.setState({
        chatUploadFileList: [
          { id: 'remove-file', status: 'success' },
          { id: 'preserve-file', status: 'success' },
        ] as any,
      });

      const removalPromise = useStore.getState().removeChatUploadFile('remove-file');
      await waitFor(() => {
        expect(fileService.removeFile).toHaveBeenCalledWith('remove-file');
      });

      const currentAccountFiles = [{ id: 'current-account-file', status: 'success' }] as any;
      act(() => {
        useUserStore.setState((state) => ({
          ownershipInvalidationGeneration: state.ownershipInvalidationGeneration + 1,
        }));
        useStore.setState({ chatUploadFileList: currentAccountFiles });
        removalFinished.resolve();
      });
      await act(async () => {
        await removalPromise;
      });

      expect(useStore.getState().chatUploadFileList).toBe(currentAccountFiles);
    });
  });

  describe('topic attachment chunking', () => {
    it('keeps screenshots and unsupported documents without sending them to chunking', async () => {
      const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
      const spreadsheet = new File(['sheet'], 'report.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      vi.spyOn(useStore.getState(), 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'image-file', url: 'https://example.com/image' })
        .mockResolvedValueOnce({ id: 'sheet-file', url: 'https://example.com/sheet' });
      const parseFileContent = vi.spyOn(ragService, 'parseFileContent');

      await useStore.getState().uploadChatFiles([screenshot, spreadsheet]);

      expect(useStore.getState().uploadWithProgress).toHaveBeenCalledTimes(2);
      expect(parseFileContent).not.toHaveBeenCalled();
    });

    it('still chunks a loader-supported topic document', async () => {
      const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      vi.spyOn(useStore.getState(), 'uploadWithProgress').mockResolvedValue({
        id: 'document-file',
        url: 'https://example.com/document',
      });
      const parseFileContent = vi.spyOn(ragService, 'parseFileContent').mockResolvedValue();

      await useStore.getState().uploadChatFiles([document]);

      expect(parseFileContent).toHaveBeenCalledWith('document-file');
    });

    it('skips MarkItDown-only images while still parsing loader-supported documents', async () => {
      setChunkableFileCapabilities({ markitdown: true });
      const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
      const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      vi.spyOn(useStore.getState(), 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'image-file', url: 'https://example.com/image' })
        .mockResolvedValueOnce({ id: 'document-file', url: 'https://example.com/document' });
      const parseFileContent = vi.spyOn(ragService, 'parseFileContent').mockResolvedValue();

      await useStore.getState().uploadChatFiles([screenshot, document]);

      expect(parseFileContent).toHaveBeenCalledTimes(1);
      expect(parseFileContent).toHaveBeenCalledWith('document-file');
      expect(parseFileContent).not.toHaveBeenCalledWith('image-file');
    });
  });

  // it('removeFile should call fileService.removeFile and update the store', async () => {
  //   const { result } = renderHook(() => useStore());
  //
  //   const fileId = 'test-id';
  //
  //   // Mock the fileService.removeFile to resolve
  //   vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
  //
  //   // Populate the list to remove an item later
  //   act(() => {
  //     useStore.setState(({ inputFilesList }) => ({ inputFilesList: [...inputFilesList, fileId] }));
  //     //   // result.current.inputFilesList.push(fileId);
  //   });
  //
  //   await act(async () => {
  //     await result.current.removeFile(fileId);
  //   });
  //
  //   expect(fileService.removeFile).toHaveBeenCalledWith(fileId);
  //   expect(result.current.inputFilesList).toEqual([]);
  // });

  // describe('uploadFile', () => {
  //   it('uploadFile should handle errors', async () => {
  //     const { result } = renderHook(() => useStore());
  //     const testFile = new File(['content'], 'test.png', { type: 'image/png' });
  //
  //     // 模拟 fileService.uploadFile 抛出错误
  //     const errorMessage = 'Upload failed';
  //     vi.spyOn(uploadService, 'uploadFile').mockRejectedValue(new Error(errorMessage));
  //
  //     // Mock console.error for testing
  //
  //     await act(async () => {
  //       await result.current.uploadFile(testFile);
  //     });
  //
  //     expect(uploadService.uploadFile).toHaveBeenCalledWith({
  //       createdAt: testFile.lastModified,
  //       data: await testFile.arrayBuffer(),
  //       fileType: testFile.type,
  //       name: testFile.name,
  //       saveMode: 'local',
  //       size: testFile.size,
  //     });
  //     // 由于上传失败，inputFilesList 应该没有变化
  //     expect(result.current.inputFilesList).toEqual([]);
  //
  //     // 确保错误提示被调用
  //     expect(notification.error).toHaveBeenCalled();
  //   });
  //
  //   it('uploadFile should upload the file and update inputFilesList', async () => {
  //     const { result } = renderHook(() => useStore());
  //     const testFile = new File(['content'], 'test.png', { type: 'image/png' });
  //
  //     // 模拟 fileService.uploadFile 返回的数据
  //     const uploadedFileData = {
  //       createdAt: testFile.lastModified,
  //       data: await testFile.arrayBuffer(),
  //       fileType: testFile.type,
  //       name: testFile.name,
  //       saveMode: 'local',
  //       size: testFile.size,
  //     };
  //
  //     // Mock the fileService.uploadFile to resolve with uploadedFileData
  //     vi.spyOn(uploadService, 'uploadFile').mockResolvedValue(uploadedFileData as DB_File);
  //     vi.spyOn(fileService, 'createFile').mockResolvedValue({ id: 'new-file-id', url: '' });
  //
  //     await act(async () => {
  //       await result.current.uploadFile(testFile);
  //     });
  //
  //     expect(fileService.createFile).toHaveBeenCalledWith({
  //       createdAt: testFile.lastModified,
  //       data: await testFile.arrayBuffer(),
  //       fileType: testFile.type,
  //       name: testFile.name,
  //       saveMode: 'local',
  //       size: testFile.size,
  //     });
  //     expect(result.current.inputFilesList).toContain('new-file-id');
  //   });
  // });
});
