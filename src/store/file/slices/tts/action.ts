import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { FileItem } from '@/types/files';

import { FileStore } from '../../store';

const FETCH_TTS_FILE = 'fetchTTSFile';

export interface TTSFileAction {
  removeTTSFile: (id: string) => Promise<void>;

  uploadTTSByArrayBuffers: (
    messageId: string,
    arrayBuffers: ArrayBuffer[],
  ) => Promise<string | undefined>;

  useFetchTTSFile: (id: string | null) => SWRResponse<FileItem>;
}

export const createTTSFileSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  TTSFileAction
> = (_, get) => ({
  removeTTSFile: async (id) => {
    await fileService.removeFile(id);
  },
  uploadTTSByArrayBuffers: async (messageId, arrayBuffers) => {
    const fileType = 'audio/mp3';
    const blob = new Blob(arrayBuffers, { type: fileType });
    const fileName = `${messageId}.mp3`;
    const fileOptions = {
      lastModified: Date.now(),
      type: fileType,
    };
    const file = new File([blob], fileName, fileOptions);

    const res = await get().uploadWithProgress({ file, skipCheckFileType: true });

    return res?.id;
  },
  useFetchTTSFile: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      id && requestedScope ? [FETCH_TTS_FILE, requestedScope, id] : null,
      () => fileService.getFile(id!),
    );
  },
});
