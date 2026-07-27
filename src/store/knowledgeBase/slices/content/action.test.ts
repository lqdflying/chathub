import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';

import { useKnowledgeBaseStore as useStore } from '../../store';

vi.mock('zustand/traditional', async (importOriginal) => await importOriginal());

const createDeferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  useUserStore.setState({
    ownershipInvalidationGeneration: 0,
    userStateInitializationFailure: undefined,
  });
  useStore.setState({
    activeKnowledgeBaseId: 'kb-1',
    scopeGeneration: 0,
  });
  useFileStore.setState({ scopeGeneration: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnowledgeBaseContentActions', () => {
  describe('account mutation quarantine', () => {
    it('blocks relationship mutations during a same-scope owner mismatch', async () => {
      const addFiles = vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase');
      const removeFiles = vi.spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase');
      useUserStore.setState({
        userStateInitializationFailure: {
          reason: 'owner-mismatch',
          scope: 'local',
        },
      });

      const store = useStore.getState();
      await store.addFilesToKnowledgeBase('kb-1', ['file-1']);
      await store.removeFilesFromKnowledgeBase('kb-1', ['file-1']);

      expect(addFiles).not.toHaveBeenCalled();
      expect(removeFiles).not.toHaveBeenCalled();
    });

    it('continues an explicit relationship refresh when the active knowledge base changes', async () => {
      const relationshipFinished = createDeferred<unknown>();
      vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase').mockReturnValue(
        relationshipFinished.promise as any,
      );
      const refreshFileList = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList,
        scopeGeneration: 7,
      } as any);

      let relationshipPromise!: Promise<void>;
      act(() => {
        relationshipPromise = useStore
          .getState()
          .addFilesToKnowledgeBase('kb-1', ['file-1']);
      });
      await waitFor(() => {
        expect(knowledgeBaseService.addFilesToKnowledgeBase).toHaveBeenCalled();
      });

      act(() => {
        useStore.setState({ activeKnowledgeBaseId: 'kb-2' });
      });
      relationshipFinished.resolve([]);
      await act(async () => {
        await relationshipPromise;
      });

      expect(refreshFileList).toHaveBeenCalledWith({
        accountMutationSnapshot: {
          ownershipInvalidationGeneration: 0,
          scope: 'local',
        },
        scopeGeneration: 7,
      });
    });
  });

  describe('addFilesToKnowledgeBase', () => {
    it.each([null, 'other-kb'])(
      'adds files to an explicit non-active knowledge base when active is %s',
      async (activeKnowledgeBaseId) => {
        useStore.setState({ activeKnowledgeBaseId });
        const addFiles = vi
          .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
          .mockResolvedValue([]);
        const refreshFileList = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList,
          scopeGeneration: 7,
        } as any);

        await useStore.getState().addFilesToKnowledgeBase('target-kb', ['file-1']);

        expect(addFiles).toHaveBeenCalledWith('target-kb', ['file-1']);
        expect(refreshFileList).toHaveBeenCalledWith({
          accountMutationSnapshot: {
            ownershipInvalidationGeneration: 0,
            scope: 'local',
          },
          scopeGeneration: 7,
        });
      },
    );

    it('should add files to knowledge base and refresh file list', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
          {
            createdAt: new Date(),
            fileId: 'file-2',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
          {
            createdAt: new Date(),
            fileId: 'file-3',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(addFilesSpy).toHaveBeenCalledTimes(1);
      expect(refreshFileListSpy).toHaveBeenCalled();
      expect(refreshFileListSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle single file addition', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(refreshFileListSpy).toHaveBeenCalled();
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];

      const addFilesSpy = vi
        .spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase')
        .mockResolvedValue([]);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(addFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(refreshFileListSpy).toHaveBeenCalled();
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to add files to knowledge base');

        vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase').mockRejectedValue(serviceError);

        const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList: refreshFileListSpy,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to add files to knowledge base');

        expect(refreshFileListSpy).not.toHaveBeenCalled();
      });

      it('should handle refresh file list errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1'];
        const refreshError = new Error('Failed to refresh file list');

        vi.spyOn(knowledgeBaseService, 'addFilesToKnowledgeBase').mockResolvedValue([
          {
            createdAt: new Date(),
            fileId: 'file-1',
            knowledgeBaseId: 'kb-1',
            userId: 'user-1',
          },
        ]);

        const refreshFileListSpy = vi.fn().mockRejectedValue(refreshError);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList: refreshFileListSpy,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to refresh file list');
      });
    });
  });

  describe('removeFilesFromKnowledgeBase', () => {
    it.each([null, 'other-kb'])(
      'removes files from an explicit non-active knowledge base when active is %s',
      async (activeKnowledgeBaseId) => {
        useStore.setState({ activeKnowledgeBaseId });
        const removeFiles = vi
          .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
          .mockResolvedValue({} as any);
        const refreshFileList = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList,
          scopeGeneration: 7,
        } as any);

        await useStore.getState().removeFilesFromKnowledgeBase('target-kb', ['file-1']);

        expect(removeFiles).toHaveBeenCalledWith('target-kb', ['file-1']);
        expect(refreshFileList).toHaveBeenCalledWith({
          accountMutationSnapshot: {
            ownershipInvalidationGeneration: 0,
            scope: 'local',
          },
          scopeGeneration: 7,
        });
      },
    );

    it('should remove files from knowledge base and refresh file list', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1', 'file-2', 'file-3'];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(removeFilesSpy).toHaveBeenCalledTimes(1);
      expect(refreshFileListSpy).toHaveBeenCalled();
      expect(refreshFileListSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle single file removal', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds = ['file-1'];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(refreshFileListSpy).toHaveBeenCalled();
    });

    it('should handle empty file array', async () => {
      const { result } = renderHook(() => useStore());

      const knowledgeBaseId = 'kb-1';
      const fileIds: string[] = [];

      const removeFilesSpy = vi
        .spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase')
        .mockResolvedValue({} as any);

      const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        refreshFileList: refreshFileListSpy,
      } as any);

      await act(async () => {
        await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
      });

      expect(removeFilesSpy).toHaveBeenCalledWith(knowledgeBaseId, fileIds);
      expect(refreshFileListSpy).toHaveBeenCalled();
    });

    describe('error handling', () => {
      it('should propagate service errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1', 'file-2'];
        const serviceError = new Error('Failed to remove files from knowledge base');

        vi.spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase').mockRejectedValue(
          serviceError,
        );

        const refreshFileListSpy = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList: refreshFileListSpy,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to remove files from knowledge base');

        expect(refreshFileListSpy).not.toHaveBeenCalled();
      });

      it('should handle refresh file list errors', async () => {
        const { result } = renderHook(() => useStore());

        const knowledgeBaseId = 'kb-1';
        const fileIds = ['file-1'];
        const refreshError = new Error('Failed to refresh file list');

        vi.spyOn(knowledgeBaseService, 'removeFilesFromKnowledgeBase').mockResolvedValue({} as any);

        const refreshFileListSpy = vi.fn().mockRejectedValue(refreshError);
        vi.spyOn(useFileStore, 'getState').mockReturnValue({
          refreshFileList: refreshFileListSpy,
        } as any);

        await expect(async () => {
          await act(async () => {
            await result.current.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);
          });
        }).rejects.toThrow('Failed to refresh file list');
      });
    });
  });
});
