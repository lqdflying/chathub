export enum ChunkStatus {
  Error = 'error',
  Processing = 'processing',
  Success = 'success',
}

export interface Elements {
  element_id: string;
  metadata: ChunkMetadata;
  text: string;
  type: string;
}

export interface ChunkMetadata {
  // Written by the MarkItDown chunking path (ContentChunk.chunkByMarkItDown).
  // Present on MarkItDownElement chunks; absent on LangChain/Unstructured chunks.
  converted_by?: string;
  coordinates: Coordinates;
  languages: string[];
  pageNumber?: number;
  parent_id?: string;
  source_file_type?: string;
  source_title?: string | null;
  text_as_html?: string;
}

export interface ChunkDisplayMetadata {
  converted_by?: string;
  source_file_type?: string;
  source_title?: string | null;
}

export interface Coordinates {
  layout_height: number;
  layout_width: number;
  points: number[][];
  system: string;
}

export interface FileChunk {
  createdAt: Date;
  id: string;
  index: number;
  metadata: ChunkMetadata | null;
  pageNumber?: number;
  parentId?: string | null;
  text: string;
  type: string;
  updatedAt: Date;
}

export interface SemanticSearchChunk {
  fileId: string | null;
  fileName: string | null;
  id: string;
  metadata: ChunkMetadata | null;
  pageNumber?: number | null;
  similarity: number;
  text: string | null;
  type: string | null;
}

export type ChatSemanticSearchChunk = Omit<SemanticSearchChunk, 'metadata' | 'type'>;

export * from './document';
