import { ImageFileState, initialImageFileState } from './slices/chat';
import { FileChunkState, initialFileChunkState } from './slices/chunk';
import { FileManagerState, initialFileManagerState } from './slices/fileManager';

export type FilesStoreState = ImageFileState & FileManagerState & FileChunkState;

export interface FileScopeState {
  fileUploadAbortControllers: AbortController[];
  scopeGeneration: number;
}

export type FileStoreState = FilesStoreState & FileScopeState;

export const initialState: FileStoreState = {
  fileUploadAbortControllers: [],
  scopeGeneration: 0,
  ...initialImageFileState,
  ...initialFileManagerState,
  ...initialFileChunkState,
};
