export enum FilesTabs {
  All = 'all',
  Audios = 'audios',
  Documents = 'documents',
  Images = 'images',
  Videos = 'videos',
  Websites = 'websites',
}

export enum FileSource {
  ImageGeneration = 'image_generation',
  KnowledgeBase = 'knowledge_base',
}

export interface ImageArtifactItem {
  createdAt: Date;
  fileType: string;
  height?: number | null;
  id: string;
  name: string;
  size: number;
  url: string;
  width?: number | null;
}

export interface ImageArtifactListInput {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'newest' | 'oldest';
}

export interface ImageArtifactListResult {
  items: ImageArtifactItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FileItem {
  createdAt: Date;
  enabled?: boolean;
  id: string;
  name: string;
  size: number;
  source?: FileSource | null;
  type: string;
  updatedAt: Date;
  url: string;
}

export * from './list';
export * from './upload';
