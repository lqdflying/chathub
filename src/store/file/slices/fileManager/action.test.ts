import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { message } from '@/components/AntdStaticMethods';
import { FILE_UPLOAD_BLACKLIST, MAX_UPLOAD_FILE_COUNT } from '@/const/file';
import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { useUserStore } from '@/store/user';
import { FileListItem } from '@/types/files';
import { UploadFileItem } from '@/types/files/upload';
import { unzipFile } from '@/utils/unzipFile';

import { useFileStore as useStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

// Mock i18next translation function
vi.mock('i18next', () => ({
  t: (key: string, options?: any) => {
    // Return a mock translation string that includes the options for verification
    if (key === 'uploadDock.fileQueueInfo' && options?.count !== undefined) {
      return `Uploading ${options.count} files, ${options.remaining} queued`;
    }
    return key;
  },
}));

// Mock message
vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock unzipFile
vi.mock('@/utils/unzipFile', () => ({
  unzipFile: vi.fn(),
}));

// Mock p-map to run sequentially for easier testing
vi.mock('p-map', () => ({
  default: vi.fn(async (items, mapper) => {
    return Promise.all(items.map(mapper));
  }),
}));

// Mock SWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock lambdaClient
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    file: {
      getFileItemById: { query: vi.fn() },
      getFiles: { query: vi.fn() },
      removeFileAsyncTask: { mutate: vi.fn() },
    },
  },
}));

const createDeferred = <Value>() => {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    authUserId: undefined,
    isLoaded: true,
    isSignedIn: false,
    ownershipInvalidationGeneration: 0,
    user: undefined,
    userStateInitializationFailure: undefined,
  });
  useStore.setState(
    {
      creatingChunkingTaskIds: [],
      creatingEmbeddingTaskIds: [],
      dockUploadFileList: [],
      fileList: [],
      queryListParams: undefined,
      scopeGeneration: 0,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileManagerActions', () => {
  describe('account mutation quarantine', () => {
    it('blocks task, removal, refresh, and local loading work during an owner mismatch', async () => {
      const { result } = renderHook(() => useStore());
      useUserStore.setState({
        userStateInitializationFailure: { reason: 'owner-mismatch', scope: 'local' },
      });
      const embeddingTaskSpy = vi.spyOn(ragService, 'createEmbeddingChunksTask');
      const parseTaskSpy = vi.spyOn(ragService, 'createParseFileTask');
      const retryParseSpy = vi.spyOn(ragService, 'retryParseFile');
      const removeAllSpy = vi.spyOn(fileService, 'removeAllFiles');
      const removeFileSpy = vi.spyOn(fileService, 'removeFile');
      const removeFilesSpy = vi.spyOn(fileService, 'removeFiles');
      const toggleEmbeddingSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');
      const toggleParsingSpy = vi.spyOn(result.current, 'toggleParsingIds');

      await result.current.embeddingChunks(['file-1']);
      await result.current.parseFilesToChunks(['file-1']);
      await result.current.reEmbeddingChunks('file-1');
      await result.current.reParseFile('file-1');
      await result.current.removeAllFiles();
      await result.current.removeFileItem('file-1');
      await result.current.removeFiles(['file-1']);
      await result.current.refreshFileList();

      expect(embeddingTaskSpy).not.toHaveBeenCalled();
      expect(parseTaskSpy).not.toHaveBeenCalled();
      expect(retryParseSpy).not.toHaveBeenCalled();
      expect(lambdaClient.file.removeFileAsyncTask.mutate).not.toHaveBeenCalled();
      expect(removeAllSpy).not.toHaveBeenCalled();
      expect(removeFileSpy).not.toHaveBeenCalled();
      expect(removeFilesSpy).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
      expect(toggleEmbeddingSpy).not.toHaveBeenCalled();
      expect(toggleParsingSpy).not.toHaveBeenCalled();
      expect(result.current.creatingEmbeddingTaskIds).toEqual([]);
      expect(result.current.creatingChunkingTaskIds).toEqual([]);
    });

    it('does not refresh or finalize a parse task after pending service invalidation', async () => {
      const { result } = renderHook(() => useStore());
      const parseFinished = createDeferred<void>();
      vi.spyOn(ragService, 'createParseFileTask').mockReturnValue(parseFinished.promise as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');
      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');

      const parsePromise = result.current.parseFilesToChunks(['file-1']);
      await vi.waitFor(() => {
        expect(ragService.createParseFileTask).toHaveBeenCalledWith('file-1', undefined);
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        useStore.setState({
          creatingChunkingTaskIds: ['account-b-task'],
          scopeGeneration: 1,
        });
      });
      parseFinished.resolve();
      await parsePromise;

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(toggleSpy).not.toHaveBeenCalledWith(['file-1'], false);
      expect(useStore.getState().creatingChunkingTaskIds).toEqual(['account-b-task']);
    });

    it('does not continue an embedding retry after its cancellation is invalidated', async () => {
      const { result } = renderHook(() => useStore());
      const cancellationFinished = createDeferred<void>();
      vi.mocked(lambdaClient.file.removeFileAsyncTask.mutate).mockReturnValue(
        cancellationFinished.promise as any,
      );
      const createTaskSpy = vi.spyOn(ragService, 'createEmbeddingChunksTask');
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');
      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      const retryPromise = result.current.reEmbeddingChunks('file-1');
      await vi.waitFor(() => {
        expect(lambdaClient.file.removeFileAsyncTask.mutate).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        useStore.setState({
          creatingEmbeddingTaskIds: ['account-b-task'],
          scopeGeneration: 1,
        });
      });
      cancellationFinished.resolve();
      await retryPromise;

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(createTaskSpy).not.toHaveBeenCalled();
      expect(toggleSpy).not.toHaveBeenCalledWith(['file-1'], false);
      expect(useStore.getState().creatingEmbeddingTaskIds).toEqual(['account-b-task']);
    });

    it('does not refresh after a pending removal is invalidated', async () => {
      const { result } = renderHook(() => useStore());
      const removalFinished = createDeferred<void>();
      vi.spyOn(fileService, 'removeFile').mockReturnValue(removalFinished.promise);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');

      const removalPromise = result.current.removeFileItem('file-1');
      await vi.waitFor(() => {
        expect(fileService.removeFile).toHaveBeenCalledWith('file-1');
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        useStore.setState({ scopeGeneration: 1 });
      });
      removalFinished.resolve();
      await removalPromise;

      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('dispatchDockFileList', () => {
    it('should update dockUploadFileList with new value', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.dispatchDockFileList({
          atStart: true,
          files: [{ file: new File([], 'test.txt'), id: 'file-1', status: 'pending' }],
          type: 'addFiles',
        });
      });

      expect(result.current.dockUploadFileList).toHaveLength(1);
      expect(result.current.dockUploadFileList[0].id).toBe('file-1');
    });

    it('should not update state if reducer returns same value', () => {
      const { result } = renderHook(() => useStore());

      const initialList = result.current.dockUploadFileList;

      // This tests the early return when value hasn't changed
      act(() => {
        useStore.setState({ dockUploadFileList: initialList });
      });

      expect(result.current.dockUploadFileList).toBe(initialList);
    });

    it('should handle updateFileStatus dispatch', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          dockUploadFileList: [
            { file: new File([], 'test.txt'), id: 'file-1', status: 'pending' },
          ] as UploadFileItem[],
        });
      });

      act(() => {
        result.current.dispatchDockFileList({
          id: 'file-1',
          status: 'success',
          type: 'updateFileStatus',
        });
      });

      expect(result.current.dockUploadFileList[0].status).toBe('success');
    });

    it('should handle removeFile dispatch', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          dockUploadFileList: [
            { file: new File([], 'test.txt'), id: 'file-1', status: 'pending' },
          ] as UploadFileItem[],
        });
      });

      act(() => {
        result.current.dispatchDockFileList({
          id: 'file-1',
          type: 'removeFile',
        });
      });

      expect(result.current.dockUploadFileList).toHaveLength(0);
    });
  });

  describe('embeddingChunks', () => {
    it('should toggle embedding ids and create tasks', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createEmbeddingChunksTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.embeddingChunks(['file-1', 'file-2']);
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(createTaskSpy).toHaveBeenCalledTimes(2);
      expect(createTaskSpy).toHaveBeenCalledWith('file-1');
      expect(createTaskSpy).toHaveBeenCalledWith('file-2');
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2'], false);
    });

    it('should handle errors gracefully and still complete', async () => {
      const { result } = renderHook(() => useStore());

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ragService, 'createEmbeddingChunksTask').mockRejectedValue(new Error('Task failed'));
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.embeddingChunks(['file-1']);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });

    it('keeps a same-file loading indicator until all overlapping operations complete', async () => {
      const { result } = renderHook(() => useStore());
      const olderEmbeddingFinished = createDeferred<void>();
      const newerEmbeddingFinished = createDeferred<void>();
      vi.spyOn(ragService, 'createEmbeddingChunksTask')
        .mockReturnValueOnce(olderEmbeddingFinished.promise as any)
        .mockReturnValueOnce(newerEmbeddingFinished.promise as any);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      const olderOperation = result.current.embeddingChunks(['file-1']);
      await vi.waitFor(() => {
        expect(ragService.createEmbeddingChunksTask).toHaveBeenCalledTimes(1);
      });

      const newerOperation = result.current.embeddingChunks(['file-1']);
      await vi.waitFor(() => {
        expect(ragService.createEmbeddingChunksTask).toHaveBeenCalledTimes(2);
      });

      expect(useStore.getState().creatingEmbeddingTaskIds).toEqual(['file-1']);

      olderEmbeddingFinished.resolve();
      await olderOperation;

      expect(useStore.getState().creatingEmbeddingTaskIds).toEqual(['file-1']);

      newerEmbeddingFinished.resolve();
      await newerOperation;

      expect(useStore.getState().creatingEmbeddingTaskIds).toEqual([]);
    });
  });

  describe('parseFilesToChunks', () => {
    it('should toggle parsing ids and create parse tasks', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createParseFileTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1', 'file-2']);
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(createTaskSpy).toHaveBeenCalledTimes(2);
      expect(createTaskSpy).toHaveBeenCalledWith('file-1', undefined);
      expect(createTaskSpy).toHaveBeenCalledWith('file-2', undefined);
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2'], false);
    });

    it('should pass skipExist parameter to createParseFileTask', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createParseFileTask')
        .mockResolvedValue(undefined as any);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1'], { skipExist: true });
      });

      expect(createTaskSpy).toHaveBeenCalledWith('file-1', true);
    });

    it('should handle errors gracefully', async () => {
      const { result } = renderHook(() => useStore());

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ragService, 'createParseFileTask').mockRejectedValue(new Error('Parse failed'));
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1']);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });

    it('keeps a same-file loading indicator until all overlapping operations complete', async () => {
      const { result } = renderHook(() => useStore());
      const olderParseFinished = createDeferred<void>();
      const newerParseFinished = createDeferred<void>();
      vi.spyOn(ragService, 'createParseFileTask')
        .mockReturnValueOnce(olderParseFinished.promise as any)
        .mockReturnValueOnce(newerParseFinished.promise as any);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      const olderOperation = result.current.parseFilesToChunks(['file-1']);
      await vi.waitFor(() => {
        expect(ragService.createParseFileTask).toHaveBeenCalledTimes(1);
      });

      const newerOperation = result.current.parseFilesToChunks(['file-1']);
      await vi.waitFor(() => {
        expect(ragService.createParseFileTask).toHaveBeenCalledTimes(2);
      });

      expect(useStore.getState().creatingChunkingTaskIds).toEqual(['file-1']);

      olderParseFinished.resolve();
      await olderOperation;

      expect(useStore.getState().creatingChunkingTaskIds).toEqual(['file-1']);

      newerParseFinished.resolve();
      await newerOperation;

      expect(useStore.getState().creatingChunkingTaskIds).toEqual([]);
    });
  });

  describe('pushDockFileList', () => {
    it('should filter blacklisted files and upload', async () => {
      const { result } = renderHook(() => useStore());

      const validFile = new File(['content'], 'valid.txt', { type: 'text/plain' });
      const blacklistedFile = new File(['content'], FILE_UPLOAD_BLACKLIST[0], {
        type: 'text/plain',
      });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([validFile, blacklistedFile]);
      });

      // Should only dispatch for the valid file
      expect(dispatchSpy).toHaveBeenCalledWith({
        atStart: true,
        files: [{ file: validFile, id: expect.any(String), status: 'pending' }],
        type: 'addFiles',
      });
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(uploadSpy).toHaveBeenCalledWith({
        file: validFile,
        knowledgeBaseId: undefined,
        mutationCheckpoint: expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
        onStatusUpdate: expect.any(Function),
      });
      expect(refreshSpy).toHaveBeenCalled();
      // Should auto-parse text files
      expect(parseSpy).toHaveBeenCalledWith(
        ['file-1'],
        { skipExist: false },
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
      );
    });

    it('should upload files with knowledgeBaseId', async () => {
      const { result } = renderHook(() => useStore());

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([file], 'kb-123');
      });

      expect(uploadSpy).toHaveBeenCalledWith({
        file,
        knowledgeBaseId: 'kb-123',
        mutationCheckpoint: expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
        onStatusUpdate: expect.any(Function),
      });
    });

    it('marks files uploaded from the Knowledge overview', async () => {
      const { result } = renderHook(() => useStore());
      const file = new File(['content'], 'knowledge.txt', { type: 'text/plain' });
      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([file], undefined, true);
      });

      expect(uploadSpy).toHaveBeenCalledWith({
        file,
        knowledgeBaseId: undefined,
        knowledgeBaseUpload: true,
        mutationCheckpoint: expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
        onStatusUpdate: expect.any(Function),
      });
    });

    it('keeps unsupported files out of Knowledge Base uploads', async () => {
      const { result } = renderHook(() => useStore());
      const document = new File(['content'], 'notes.txt', { type: 'text/plain' });
      const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
      const spreadsheet = new File(['sheet'], 'report.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([document, screenshot, spreadsheet], 'kb-123');
      });

      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(uploadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ file: document, knowledgeBaseId: 'kb-123' }),
      );
    });

    it('should call onStatusUpdate during upload', async () => {
      const { result } = renderHook(() => useStore());

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockImplementation(async ({ onStatusUpdate }) => {
          onStatusUpdate?.({ id: file.name, type: 'updateFile', value: { status: 'uploading' } });
          return { id: 'file-1', url: 'http://example.com/file-1' };
        });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');

      await act(async () => {
        await result.current.pushDockFileList([file]);
      });

      expect(uploadSpy).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('should handle empty file list', async () => {
      const { result } = renderHook(() => useStore());

      const uploadSpy = vi.spyOn(result.current, 'uploadWithProgress');
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks');

      await act(async () => {
        await result.current.pushDockFileList([]);
      });

      expect(uploadSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should auto-embed files that support chunking', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });
      const pdfFile = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile, pdfFile]);
      });

      // Should auto-parse both files that support chunking
      expect(parseSpy).toHaveBeenCalledWith(
        ['file-1', 'file-2'],
        { skipExist: false },
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
      );
    });

    it('should skip auto-embed for unsupported file types (images/videos/audio)', async () => {
      const { result } = renderHook(() => useStore());

      const imageFile = new File(['image content'], 'image.png', { type: 'image/png' });
      const videoFile = new File(['video content'], 'video.mp4', { type: 'video/mp4' });
      const audioFile = new File(['audio content'], 'audio.mp3', { type: 'audio/mpeg' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' })
        .mockResolvedValueOnce({ id: 'file-3', url: 'http://example.com/file-3' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([imageFile, videoFile, audioFile]);
      });

      // Should not auto-parse unsupported files
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should auto-embed only supported files in mixed upload', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });
      const imageFile = new File(['image content'], 'image.png', { type: 'image/png' });
      const pdfFile = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' })
        .mockResolvedValueOnce({ id: 'file-3', url: 'http://example.com/file-3' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile, imageFile, pdfFile]);
      });

      // Should only auto-parse text and pdf files, skip image
      expect(parseSpy).toHaveBeenCalledWith(
        ['file-1', 'file-3'],
        { skipExist: false },
        expect.objectContaining({
          accountMutationSnapshot: expect.objectContaining({ scope: 'local' }),
          scopeGeneration: 0,
        }),
      );
    });

    it('should skip auto-embed when upload fails', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });

      vi.spyOn(result.current, 'uploadWithProgress').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile]);
      });

      // Should not auto-parse when upload returns undefined
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should enforce file count limit and queue excess files', async () => {
      const { result } = renderHook(() => useStore());

      // Create more files than the limit
      const totalFiles = MAX_UPLOAD_FILE_COUNT + 5;
      const files = Array.from(
        { length: totalFiles },
        (_, i) => new File(['content'], `file-${i}.txt`, { type: 'text/plain' }),
      );

      vi.spyOn(result.current, 'uploadWithProgress').mockResolvedValue({
        id: 'file-1',
        url: 'http://example.com/file-1',
      });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');

      await act(async () => {
        await result.current.pushDockFileList(files);
      });

      // Should add all files to dock (not just first MAX_UPLOAD_FILE_COUNT)
      expect(dispatchSpy).toHaveBeenCalledWith({
        atStart: true,
        files: expect.arrayContaining([
          expect.objectContaining({ file: expect.any(File), status: 'pending' }),
        ]),
        type: 'addFiles',
      });

      // Verify all files were dispatched
      const dispatchCall = dispatchSpy.mock.calls.find((call) => call[0].type === 'addFiles');
      expect(dispatchCall?.[0]).toHaveProperty('files');
      if (dispatchCall && 'files' in dispatchCall[0]) {
        expect(dispatchCall[0].files).toHaveLength(totalFiles);
      }
    });

    it('should extract ZIP files and upload contents', async () => {
      const { result } = renderHook(() => useStore());

      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });
      const extractedFiles = [
        new File(['file1'], 'file1.txt', { type: 'text/plain' }),
        new File(['file2'], 'file2.txt', { type: 'text/plain' }),
      ];

      vi.mocked(unzipFile).mockResolvedValue(extractedFiles);
      vi.spyOn(result.current, 'uploadWithProgress').mockResolvedValue({
        id: 'file-1',
        url: 'http://example.com/file-1',
      });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');

      await act(async () => {
        await result.current.pushDockFileList([zipFile]);
      });

      // Should extract ZIP file
      expect(unzipFile).toHaveBeenCalledWith(zipFile);

      // Should upload extracted files
      expect(dispatchSpy).toHaveBeenCalledWith({
        atStart: true,
        files: extractedFiles.map((file) => ({ file, id: expect.any(String), status: 'pending' })),
        type: 'addFiles',
      });
    });

    it('filters unsupported ZIP contents when uploading to a Knowledge Base', async () => {
      const { result } = renderHook(() => useStore());
      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });
      const document = new File(['file1'], 'file1.txt', { type: 'text/plain' });
      const screenshot = new File(['file2'], 'screenshot.png', { type: 'image/png' });

      vi.mocked(unzipFile).mockResolvedValue([document, screenshot]);
      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([zipFile], 'kb-123');
      });

      expect(unzipFile).toHaveBeenCalledWith(zipFile);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(uploadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ file: document, knowledgeBaseId: 'kb-123' }),
      );
    });

    it('uploads ZIP-extracted same-name files and updates their own optimistic rows', async () => {
      const { result } = renderHook(() => useStore());
      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });
      const firstExtractedFile = new File(['first'], 'duplicate.txt', { type: 'text/plain' });
      const secondExtractedFile = new File(['second'], 'duplicate.txt', { type: 'text/plain' });

      vi.mocked(unzipFile).mockResolvedValue([firstExtractedFile, secondExtractedFile]);
      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockImplementation(async ({ file, onStatusUpdate }) => {
          const isFirstFile = file === firstExtractedFile;
          const serverFileId = isFirstFile ? 'server-file-1' : 'server-file-2';
          const fileUrl = `https://example.com/${serverFileId}`;

          onStatusUpdate?.({
            id: file.name,
            type: 'updateFile',
            value: {
              fileUrl,
              id: serverFileId,
              status: 'success',
            },
          });

          return { id: serverFileId, url: fileUrl };
        });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([zipFile]);
      });

      expect(uploadSpy).toHaveBeenCalledTimes(2);
      expect(uploadSpy.mock.calls.map(([params]) => params.file)).toEqual([
        firstExtractedFile,
        secondExtractedFile,
      ]);

      const firstEntry = useStore
        .getState()
        .dockUploadFileList.find((fileItem) => fileItem.file === firstExtractedFile);
      const secondEntry = useStore
        .getState()
        .dockUploadFileList.find((fileItem) => fileItem.file === secondExtractedFile);

      expect(firstEntry).toMatchObject({
        fileUrl: 'https://example.com/server-file-1',
        status: 'success',
      });
      expect(secondEntry).toMatchObject({
        fileUrl: 'https://example.com/server-file-2',
        status: 'success',
      });
      expect(firstEntry?.id).not.toBe(secondEntry?.id);
      expect(firstEntry?.id).not.toBe(firstExtractedFile.name);
      expect(secondEntry?.id).not.toBe(secondExtractedFile.name);
    });

    it('should handle ZIP extraction errors gracefully', async () => {
      const { result } = renderHook(() => useStore());

      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });

      vi.mocked(unzipFile).mockRejectedValue(new Error('Extraction failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(result.current, 'uploadWithProgress').mockResolvedValue({
        id: 'file-1',
        url: 'http://example.com/file-1',
      });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');

      await act(async () => {
        await result.current.pushDockFileList([zipFile]);
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalled();

      // Should fallback to uploading the ZIP file itself
      expect(dispatchSpy).toHaveBeenCalledWith({
        atStart: true,
        files: [{ file: zipFile, id: expect.any(String), status: 'pending' }],
        type: 'addFiles',
      });
    });

    it('does not preprocess, dispatch, or upload during an active owner mismatch', async () => {
      const { result } = renderHook(() => useStore());
      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });
      useUserStore.setState({
        userStateInitializationFailure: { reason: 'owner-mismatch', scope: 'local' },
      });
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');
      const uploadSpy = vi.spyOn(result.current, 'uploadWithProgress');

      await act(async () => {
        await result.current.pushDockFileList([zipFile]);
      });

      expect(unzipFile).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(result.current.dockUploadFileList).toEqual([]);
    });

    it('stops after ZIP preprocessing is invalidated', async () => {
      const { result } = renderHook(() => useStore());
      const zipFile = new File(['zip content'], 'archive.zip', { type: 'application/zip' });
      const extractionFinished = createDeferred<File[]>();
      vi.mocked(unzipFile).mockReturnValue(extractionFinished.promise);
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');
      const uploadSpy = vi.spyOn(result.current, 'uploadWithProgress');

      const pushPromise = result.current.pushDockFileList([zipFile]);
      await vi.waitFor(() => {
        expect(unzipFile).toHaveBeenCalledWith(zipFile);
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        useStore.setState({ scopeGeneration: 1 });
      });
      extractionFinished.resolve([new File(['text'], 'extracted.txt', { type: 'text/plain' })]);
      await pushPromise;

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(result.current.dockUploadFileList).toEqual([]);
    });

    it('does not refresh or parse after upload invalidation', async () => {
      const { result } = renderHook(() => useStore());
      const file = new File(['content'], 'document.txt', { type: 'text/plain' });
      const uploadFinished = createDeferred<{ id: string; url: string } | undefined>();
      vi.spyOn(result.current, 'uploadWithProgress').mockReturnValue(uploadFinished.promise);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks');

      const pushPromise = result.current.pushDockFileList([file]);
      await vi.waitFor(() => {
        expect(result.current.uploadWithProgress).toHaveBeenCalled();
      });

      act(() => {
        useUserStore.setState({ ownershipInvalidationGeneration: 1 });
        useStore.setState({ scopeGeneration: 1 });
      });
      uploadFinished.resolve({ id: 'stale-file', url: 'https://example.com/stale-file' });
      await pushPromise;

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('keeps stale callbacks from mutating a newer same-name upload entry', async () => {
      const { result } = renderHook(() => useStore());
      const olderFile = new File(['older'], 'same-name.txt', { type: 'text/plain' });
      const newerFile = new File(['newer'], 'same-name.txt', { type: 'text/plain' });
      const uploadFinished = createDeferred<{ id: string; url: string } | undefined>();
      let olderStatusUpdate:
        | ((payload: { id: string; type: 'updateFile'; value: Partial<UploadFileItem> }) => void)
        | undefined;
      vi.spyOn(result.current, 'uploadWithProgress')
        .mockImplementationOnce(({ onStatusUpdate }) => {
          olderStatusUpdate = onStatusUpdate as typeof olderStatusUpdate;
          return uploadFinished.promise;
        })
        .mockImplementationOnce(async ({ onStatusUpdate }) => {
          onStatusUpdate?.({
            id: newerFile.name,
            type: 'updateFile',
            value: { status: 'uploading' },
          });
          return undefined;
        });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      const olderPush = result.current.pushDockFileList([olderFile]);
      await vi.waitFor(() => {
        expect(olderStatusUpdate).toBeDefined();
      });
      await result.current.pushDockFileList([newerFile]);
      const newerEntry = useStore
        .getState()
        .dockUploadFileList.find((fileItem) => fileItem.file === newerFile);
      expect(newerEntry?.status).toBe('uploading');

      act(() => {
        olderStatusUpdate?.({
          id: olderFile.name,
          type: 'updateFile',
          value: { status: 'success' },
        });
      });
      uploadFinished.resolve(undefined);
      await olderPush;

      expect(
        useStore.getState().dockUploadFileList.find((fileItem) => fileItem.file === newerFile)
          ?.status,
      ).toBe('uploading');
    });
  });

  describe('reEmbeddingChunks', () => {
    it('should skip if already creating task', async () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.reEmbeddingChunks('file-1');
      });

      expect(toggleSpy).not.toHaveBeenCalled();
      expect(lambdaClient.file.removeFileAsyncTask.mutate).not.toHaveBeenCalled();
    });

    it('should remove old task and create new embedding task', async () => {
      const { result } = renderHook(() => useStore());

      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');
      vi.mocked(lambdaClient.file.removeFileAsyncTask.mutate).mockResolvedValue(undefined as any);
      const createTaskSpy = vi
        .spyOn(ragService, 'createEmbeddingChunksTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.reEmbeddingChunks('file-1');
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1']);
      expect(lambdaClient.file.removeFileAsyncTask.mutate).toHaveBeenCalledWith({
        id: 'file-1',
        type: 'embedding',
      });
      expect(createTaskSpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('reParseFile', () => {
    it('should toggle parsing and retry parse', async () => {
      const { result } = renderHook(() => useStore());

      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');
      const retrySpy = vi.spyOn(ragService, 'retryParseFile').mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.reParseFile('file-1');
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1']);
      expect(retrySpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('reParseFileWithMarkItDown', () => {
    it('should toggle parsing and retry parse via the MarkItDown-forced service', async () => {
      const { result } = renderHook(() => useStore());

      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');
      const retrySpy = vi
        .spyOn(ragService, 'retryParseFileWithMarkItDown')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.reParseFileWithMarkItDown('file-1');
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1']);
      expect(retrySpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('refreshFileList', () => {
    it('should call mutate with correct key', async () => {
      const { result } = renderHook(() => useStore());

      const params = { category: 'all' };
      act(() => {
        useStore.setState({ queryListParams: params });
      });

      await act(async () => {
        await result.current.refreshFileList();
      });

      expect(mutate).toHaveBeenCalledWith([
        'useFetchFileManage',
        'local',
        params,
        ['account-cache-epoch', 0],
      ]);
    });

    it('should call mutate with undefined params', async () => {
      const { result } = renderHook(() => useStore());

      await act(async () => {
        await result.current.refreshFileList();
      });

      expect(mutate).toHaveBeenCalledWith([
        'useFetchFileManage',
        'local',
        undefined,
        ['account-cache-epoch', 0],
      ]);
    });
  });

  describe('removeAllFiles', () => {
    it('should call fileService.removeAllFiles', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeAllFiles').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeAllFiles();
      });

      expect(removeSpy).toHaveBeenCalled();
    });
  });

  describe('removeFileItem', () => {
    it('should remove file and refresh list', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.removeFileItem('file-1');
      });

      expect(removeSpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('should remove multiple files and refresh list', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeFiles').mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.removeFiles(['file-1', 'file-2']);
      });

      expect(removeSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toggleEmbeddingIds', () => {
    it('should add ids when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1', 'file-2']);
    });

    it('should remove ids when loading is false', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1', 'file-2', 'file-3'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2'], false);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-3']);
    });

    it('should toggle ids when loading is undefined', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2']);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-2']);
    });

    it('should handle empty initial state', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleEmbeddingIds(['file-1'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1']);
    });

    it('should not duplicate ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1']);
    });
  });

  describe('toggleParsingIds', () => {
    it('should add ids when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1', 'file-2']);
    });

    it('should remove ids when loading is false', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1', 'file-2', 'file-3'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2'], false);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-3']);
    });

    it('should toggle ids when loading is undefined', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2']);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-2']);
    });

    it('should handle empty initial state', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleParsingIds(['file-1'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1']);
    });

    it('should not duplicate ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1']);
    });
  });

  describe('useFetchFileItem', () => {
    it('should not fetch when id is undefined', () => {
      const { result } = renderHook(() => useStore());

      renderHook(() => result.current.useFetchFileItem(undefined));

      expect(lambdaClient.file.getFileItemById.query).not.toHaveBeenCalled();
    });

    it('should fetch file item when id is provided', async () => {
      const { result } = renderHook(() => useStore());

      const mockFile: FileListItem = {
        chunkCount: null,
        chunkingError: null,
        createdAt: new Date(),
        embeddingError: null,
        fileType: 'text/plain',
        finishEmbedding: false,
        id: 'file-1',
        name: 'test.txt',
        size: 100,
        updatedAt: new Date(),
        url: 'http://example.com/test.txt',
      };

      vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue(mockFile);

      const { result: swrResult } = renderHook(() => result.current.useFetchFileItem('file-1'));

      await waitFor(() => {
        expect(swrResult.current.data).toEqual(mockFile);
      });
    });
  });

  describe('useFetchFileManage', () => {
    it('should fetch file list with params', async () => {
      const { result } = renderHook(() => useStore());

      const mockFiles: FileListItem[] = [
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-1',
          name: 'test1.txt',
          size: 100,
          updatedAt: new Date(),
          url: 'http://example.com/test1.txt',
        },
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-2',
          name: 'test2.txt',
          size: 200,
          updatedAt: new Date(),
          url: 'http://example.com/test2.txt',
        },
      ];

      vi.mocked(lambdaClient.file.getFiles.query).mockResolvedValue(mockFiles);

      const params = { category: 'all' as any };
      const { result: swrResult } = renderHook(() => result.current.useFetchFileManage(params));

      await waitFor(() => {
        expect(swrResult.current.data).toEqual(mockFiles);
      });
    });

    it('should update store state on successful fetch', async () => {
      const { result } = renderHook(() => useStore());

      const mockFiles: FileListItem[] = [
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-1',
          name: 'test.txt',
          size: 100,
          updatedAt: new Date(),
          url: 'http://example.com/test.txt',
        },
      ];

      vi.mocked(lambdaClient.file.getFiles.query).mockResolvedValue(mockFiles);

      const params = { category: 'all' as any };
      renderHook(() => result.current.useFetchFileManage(params));

      await waitFor(() => {
        expect(result.current.fileList).toEqual(mockFiles);
        expect(result.current.queryListParams).toEqual(params);
      });
    });
  });
});
