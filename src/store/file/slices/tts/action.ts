import { SWRResponse } from 'swr';
import { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { FileItem } from '@/types/files';

import { FileStore } from '../../store';

const FETCH_TTS_FILE = 'fetchTTSFile';

const captureTTSMutationSnapshot = (state: FileStore) => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return;

  return {
    account,
    scopeGeneration: state.scopeGeneration,
  };
};

const isTTSMutationCurrent = (
  state: FileStore,
  snapshot: NonNullable<ReturnType<typeof captureTTSMutationSnapshot>>,
) =>
  isAccountMutationCurrent(useUserStore.getState(), snapshot.account) &&
  state.scopeGeneration === snapshot.scopeGeneration;

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
    const mutationSnapshot = captureTTSMutationSnapshot(get());
    if (!mutationSnapshot || !isTTSMutationCurrent(get(), mutationSnapshot)) return;

    await fileService.removeFile(id);
  },
  uploadTTSByArrayBuffers: async (messageId, arrayBuffers) => {
    const mutationSnapshot = captureTTSMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const accountInvalidationController = new AbortController();
    const unsubscribeFromAccountInvalidation = useUserStore.subscribe((state) => {
      if (!isAccountMutationCurrent(state, mutationSnapshot.account)) {
        accountInvalidationController.abort();
      }
    });
    const fileType = 'audio/mp3';
    const blob = new Blob(arrayBuffers, { type: fileType });
    const fileName = `${messageId}.mp3`;
    const fileOptions = {
      lastModified: Date.now(),
      type: fileType,
    };
    const file = new File([blob], fileName, fileOptions);

    try {
      if (!isTTSMutationCurrent(get(), mutationSnapshot)) return;
      const res = await get().uploadWithProgress({
        file,
        signal: accountInvalidationController.signal,
      });
      if (!isTTSMutationCurrent(get(), mutationSnapshot)) return;

      return res?.id;
    } finally {
      unsubscribeFromAccountInvalidation();
    }
  },
  useFetchTTSFile: (id) => {
    const requestedScope = useUserStore(authSelectors.currentUserScope);

    return useClientDataSWR(
      id && requestedScope ? [FETCH_TTS_FILE, requestedScope, id] : null,
      () => fileService.getFile(id!),
    );
  },
});
