import { z } from 'zod';

import { AsyncTaskStatus } from '@/types/asyncTask';

export interface FileListItem {
  chunkCount: number | null;
  chunkingError: any | null;
  chunkingStatus?: AsyncTaskStatus | null;
  createdAt: Date;
  embeddingError: any | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType: string;
  finishEmbedding: boolean;
  id: string;
  name: string;
  size: number;
  updatedAt: Date;
  url: string;
}

export enum SortType {
  Asc = 'asc',
  Desc = 'desc',
}

export const QueryFileListSchema = z.object({
  category: z.string().optional(),
  chunkableOnly: z.boolean().default(false),
  knowledgeBaseId: z.string().optional(),
  knowledgeBaseOnly: z.boolean().default(false),
  q: z.string().nullable().optional(),
  showFilesInKnowledgeBase: z.boolean().default(false),
  sortType: z.enum(['desc', 'asc']).optional(),
  sorter: z.enum(['createdAt', 'size']).optional(),
});

export type QueryFileListSchemaType = z.infer<typeof QueryFileListSchema>;

export interface QueryFileListParams {
  category?: string;
  chunkableOnly?: boolean;
  knowledgeBaseId?: string;
  knowledgeBaseOnly?: boolean;
  q?: string | null;
  showFilesInKnowledgeBase?: boolean;
  sortType?: string;
  sorter?: string;
}
